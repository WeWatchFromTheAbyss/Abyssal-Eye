#!/usr/bin/env perl
# The Abyssal Eye's local server, one small Perl script for every platform (Windows runs it in the Perl that ships
# with Git for Windows, macOS and Linux in the system perl). Shared by every Claude session on this machine.
# Each project has one view at /p/<key>/ and one event stream; sessions POST raw JSON lines to
# /push?p=<key>&s=<session>&i=<instance>, the server numbers them, the page polls /p/<key>/events?since=<seq>.
# One plugin instance owns a session's stream at a time (a second copy of the plugin in the same session is refused).
# Exits once no session has pushed or pinged for a while.
# Loopback only: it listens on 127.0.0.1 (and ::1 when it can), refuses any peer that is not loopback, and refuses a
# POST carrying a foreign Origin, so no site in a browser can push into or read a stream. The view's own pages (same
# origin) may POST /open-external and their heartbeat /seen; the plugin reads GET /seen before it asks for the view
# to be opened.
use strict;
use warnings;
use IO::Socket::INET;
use IO::Select;
use Fcntl qw(:flock);
use File::Spec;
use Cwd qw(abs_path);
use Time::HiRes qw(time);
use JSON::PP;
use POSIX qw(strftime);

my ($root, $port, $daemon) = ('', 7311, 0);
while (@ARGV) {
  my $a = shift @ARGV;
  if ($a eq '--root') { $root = shift @ARGV // '' }
  elsif ($a eq '--port') { $port = int(shift @ARGV // 7311) }
  elsif ($a eq '--daemon') { $daemon = 1 }
}
die "usage: server.pl --root <web folder> [--port 7311] [--daemon]\n" unless $root ne '' && -d $root;
my $rootFull = abs_path($root);

# --daemon: the launcher returns at once while the server lives on, on its own, with no terminal: the parent exits,
# the child lets go of the terminal and its standard streams (the plugin's pipes close, so its call completes)
if ($daemon) {
  my $pid = fork();
  exit 1 unless defined $pid;
  exit 0 if $pid;
  eval { POSIX::setsid() };
  open(STDIN, '<', File::Spec->devnull); open(STDOUT, '>', File::Spec->devnull); open(STDERR, '>', File::Spec->devnull);
}

# one server per machine: sessions that start together may each launch one, and only the first stays
# the lock file is the user's own: the runtime dir, else ~/.cache, else the temp dir with the user name in the name
my $user = $ENV{USER} // $ENV{USERNAME} // 'user'; $user =~ s/[^A-Za-z0-9_.-]/_/g;
my $lockDir = ($ENV{XDG_RUNTIME_DIR} && -d $ENV{XDG_RUNTIME_DIR}) ? $ENV{XDG_RUNTIME_DIR}
  : ($ENV{HOME} && -d "$ENV{HOME}/.cache") ? "$ENV{HOME}/.cache" : '';
my $lockPath = $lockDir ne '' ? File::Spec->catfile($lockDir, 'abyssal-eye-server.lock') : File::Spec->catfile(File::Spec->tmpdir, "abyssal-eye-server-$user.lock");
open(my $lock, '>>', $lockPath) or exit 0;
exit 0 unless flock($lock, LOCK_EX | LOCK_NB);

$SIG{CHLD} = 'IGNORE'; # the system browser is started without a wait
$SIG{PIPE} = 'IGNORE';

my @listeners;
my $base = $port;
for (my $p = $base; $p < $base + 30; $p++) {
  my $l4 = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $p, Proto => 'tcp', Listen => 16, ReuseAddr => 0) or next;
  push @listeners, $l4;
  # IPv6 loopback too, when the system has it
  eval {
    require IO::Socket::IP;
    my $l6 = IO::Socket::IP->new(LocalHost => '::1', LocalPort => $p, Proto => 'tcp', Listen => 16, V6Only => 1);
    push @listeners, $l6 if $l6;
  };
  $port = $p;
  last;
}
exit 1 unless @listeners;

my $version = 'abyssal-eye-server 5';
my %projects;
my %seen;
my %reloadAt;
my %prefs; # per project: what the view asked for (history => 0|1), read by the plugin
my $lastPing = time;
my %types = ('.html' => 'text/html; charset=utf-8', '.js' => 'text/javascript; charset=utf-8', '.css' => 'text/css', '.svg' => 'image/svg+xml', '.png' => 'image/png');
my $json = JSON::PP->new->utf8;
my @own = ("http://localhost:$port", "http://127.0.0.1:$port", "http://[::1]:$port");

sub nowMs { return int(time * 1000) }

# ---------- a request, read with a deadline; a response, written with one ----------
sub readRequest {
  my ($c) = @_;
  my $sel = IO::Select->new($c);
  my $buf = '';
  my $deadline = time + 4;
  while (index($buf, "\r\n\r\n") < 0) {
    my $left = $deadline - time;
    return undef if $left <= 0 || length($buf) > 65536;
    return undef unless $sel->can_read($left);
    my $n = sysread($c, $buf, 16384, length($buf));
    return undef unless $n;
  }
  my $hdrEnd = index($buf, "\r\n\r\n");
  my $head = substr($buf, 0, $hdrEnd);
  my $body = substr($buf, $hdrEnd + 4);
  my @lines = split(/\r\n/, $head);
  my $reqLine = shift @lines // '';
  my ($method, $target) = $reqLine =~ /^([A-Z]+)\s+(\S+)/ or return undef;
  my %h;
  for my $ln (@lines) { if ($ln =~ /^([^:]+):\s*(.*)$/) { $h{lc $1} = $2 } }
  my $len = int($h{'content-length'} // 0);
  return undef if $len > 8 * 1024 * 1024;
  while (length($body) < $len) {
    my $left = $deadline - time;
    return undef if $left <= 0;
    return undef unless $sel->can_read($left);
    my $n = sysread($c, $body, 65536, length($body));
    return undef unless $n;
  }
  my ($path, $query) = split(/\?/, $target, 2);
  $path =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge;
  return { method => $method, path => $path, query => parseQuery($query // ''), headers => \%h, body => substr($body, 0, $len) };
}
sub parseQuery {
  my ($q) = @_;
  my %out;
  for my $pair (split(/&/, $q)) {
    my ($k, $v) = split(/=/, $pair, 2);
    next unless defined $k && $k ne '';
    for ($k, $v) { next unless defined; s/\+/ /g; s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge }
    $out{$k} = $v // '';
  }
  return \%out;
}
sub send_ {
  my ($c, $status, $type, $body, $extra) = @_;
  my %st = (200 => 'OK', 302 => 'Found', 400 => 'Bad Request', 403 => 'Forbidden', 404 => 'Not Found', 405 => 'Method Not Allowed', 409 => 'Conflict', 410 => 'Gone', 429 => 'Too Many Requests');
  my $head = "HTTP/1.1 $status " . ($st{$status} // 'OK') . "\r\nContent-Type: $type\r\nContent-Length: " . length($body) . "\r\nCache-Control: no-store\r\nConnection: close\r\n" . ($extra // '') . "\r\n";
  my $data = $head . $body;
  my $sel = IO::Select->new($c);
  my $deadline = time + 4;
  my $off = 0;
  # a client that stops reading must not hang the loop
  while ($off < length($data)) {
    my $left = $deadline - time;
    last if $left <= 0 || !$sel->can_write($left);
    my $n = syswrite($c, $data, length($data) - $off, $off);
    last unless defined $n;
    $off += $n;
  }
}
sub text { my ($c, $status, $s) = @_; utf8::encode($s) if utf8::is_utf8($s); send_($c, $status, 'text/plain; charset=utf-8', $s) }
sub redirect { my ($c, $to) = @_; send_($c, 302, 'text/plain; charset=utf-8', '', "Location: $to\r\n") }
sub html { my ($s) = @_; $s =~ s/&/&amp;/g; $s =~ s/</&lt;/g; $s =~ s/>/&gt;/g; $s =~ s/"/&quot;/g; return $s }
sub escapeData { my ($s) = @_; $s =~ s/([^A-Za-z0-9\-_.~])/sprintf('%%%02X', ord($1))/ge; return $s }

sub project {
  my ($key, $name) = @_;
  # at most 64 projects are held; past that the one not pushed to for longest goes (its pages refetch when it returns)
  if (!$projects{$key} && keys(%projects) >= 64) {
    my ($oldest) = sort { $projects{$a}{last} <=> $projects{$b}{last} } keys %projects;
    delete $projects{$oldest}; delete $seen{$oldest}; delete $reloadAt{$oldest}; delete $prefs{$oldest};
  }
  $projects{$key} //= { name => $name, epoch => nowMs(), raw => [], owner => [], sessions => {}, last => time };
  $projects{$key}{name} = $name if defined $name && $name ne '';
  return $projects{$key};
}

# the page's version token: changes whenever the page's files change, so open pages can reload themselves
sub stamp {
  my $s = 0;
  for my $f ('index.html', 'core.js', 'layout.js', 'draw.js', 'main.js') { my $fp = File::Spec->catfile($rootFull, $f); $s += (stat($fp))[9] if -e $fp }
  return "$s";
}
# heartbeats: each open page of a project reports every few seconds (its instance id, the version it loaded, whether
# it is shown); only pages seen within 10 s count as alive
sub seenJson {
  my ($key) = @_;
  my $now = nowMs();
  my ($alive, $vis, $cur, $latest) = (0, 0, 0, 0);
  my $st = stamp();
  if ($seen{$key}) {
    for my $id (keys %{ $seen{$key} }) {
      my $h = $seen{$key}{$id};
      if ($now - $h->{t} > 10000) { delete $seen{$key}{$id}; next }
      $alive++;
      $vis++ if $h->{vis} eq '1';
      $cur++ if $h->{v} eq $st;
      $latest = $h->{t} if $h->{t} > $latest;
    }
  }
  my $epoch = $projects{$key} ? $projects{$key}{epoch} : 0;
  return "{\"alive\":$alive,\"visible\":$vis,\"current\":$cur,\"latest\":$latest,\"version\":\"$st\",\"epoch\":$epoch}";
}

sub indexHtml {
  my $rows = '';
  for my $k (sort { $projects{$b}{last} <=> $projects{$a}{last} } keys %projects) {
    my $pr = $projects{$k};
    my $live = grep { time - $_->{last} < 90 } values %{ $pr->{sessions} };
    $rows .= '<li><a href="/p/' . html($k) . '/">' . html($pr->{name}) . "</a><span>$live live session" . ($live == 1 ? '' : 's') . '</span></li>';
  }
  $rows = '<li><span>No projects yet. Start Claude Code in a project.</span></li>' if $rows eq '';
  return "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Abyssal Eye</title>" .
    "<style>body{margin:0;background:#1C2321;color:#DCD2B0;font:15px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}main{max-width:560px;margin:12vh auto;padding:0 16px}" .
    "h1{font-weight:500;font-size:18px;color:#A8843A}ul{list-style:none;padding:0}li{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2A2E2A}" .
    "a{color:#DCD2B0;text-decoration:none}a:hover{color:#4FB3BF}span{color:#7E7A68}</style><main><h1>Abyssal Eye</h1><ul>$rows</ul></main>";
}

# the system browser, by platform, with the address built here
sub openExternal {
  my ($url) = @_;
  my @cmd = $^O eq 'darwin' ? ('open', $url) : ($^O =~ /^(MSWin32|msys|cygwin)$/ ? ('cmd', '/c', 'start', '', $url) : ('xdg-open', $url));
  my $pid = fork();
  return unless defined $pid;
  if ($pid == 0) { open(STDOUT, '>', File::Spec->devnull); open(STDERR, '>', File::Spec->devnull); exec(@cmd); exit 0 }
}

sub isLoopback { my ($ip) = @_; return defined $ip && ($ip eq '127.0.0.1' || $ip eq '::1' || $ip eq '::ffff:127.0.0.1' || $ip =~ /^127\./) }

# ---------- one request ----------
sub handle {
  my ($c) = @_;
  my $peer = eval { $c->peerhost } // '';
  if (!isLoopback($peer)) { text($c, 403, 'loopback only'); return }
  my $r = readRequest($c) or return;
  my ($method, $path, $q, $h) = ($r->{method}, $r->{path}, $r->{query}, $r->{headers});
  # the Host must be this machine's own name for the server: a page on another name could otherwise be pointed at it
  my $host = lc($h->{host} // ''); $host =~ s/^(\[::1\]|[^:]+)(:\d+)?$/$1/;
  if ($host ne 'localhost' && $host ne '127.0.0.1' && $host ne '[::1]') { text($c, 403, 'unknown host'); return }
  my $origin = $h->{origin} // '';
  my $ownOrigin = grep { $_ eq $origin } @own;
  # a POST from a web page carries an Origin: only this server's own pages (the view) may post, and only to these
  if ($method eq 'POST' && $origin ne '' && !($ownOrigin && ($path eq '/open-external' || $path eq '/seen' || $path eq '/pref'))) { text($c, 403, 'no cross-site posts'); return }
  if ($path eq '/hello') { text($c, 200, $version); return }
  if ($path =~ m{^/p/[^/]+/version$}) { text($c, 200, stamp()); return }
  if ($path eq '/seen') {
    my $key = $q->{p} // '';
    if ($key eq '' || length($key) > 80) { text($c, 400, 'p is required'); return }
    if ($method eq 'POST') {
      # a page's heartbeat (same origin only, enforced above); the answer carries the current version and epoch
      my $id = $q->{i} // '';
      if ($origin eq '' || $id eq '' || length($id) > 16) { text($c, 400, 'i is required'); return }
      $seen{$key} //= {};
      if (keys(%{ $seen{$key} }) >= 32 && !$seen{$key}{$id}) { text($c, 429, 'too many pages'); return }
      my $prevT = $seen{$key}{$id} ? $seen{$key}{$id}{t} : 0;
      my $t = nowMs();
      $seen{$key}{$id} = { t => $t, v => $q->{v} // '', vis => $q->{vis} // '' };
      # a reload asked for since this page last reported is handed to it once
      my $doReload = $reloadAt{$key} && $reloadAt{$key} > $prevT && ($t - $reloadAt{$key}) < 20000;
      my $j = seenJson($key);
      $j = substr($j, 0, length($j) - 1) . ',"reload":1}' if $doReload;
      send_($c, 200, 'application/json', $j); return;
    }
    # the plugin (no Origin) may ask the project's pages to reload on their next heartbeat
    $reloadAt{$key} = nowMs() if $origin eq '' && ($q->{reload} // '') eq '1';
    send_($c, 200, 'application/json', seenJson($key)); return;
  }
  if ($path eq '/pref') {
    # the view's own preferences for the plugin (same origin to set, the plugin to read): history on or off
    my $key = $q->{p} // '';
    if ($key eq '' || length($key) > 80) { text($c, 400, 'p is required'); return }
    if ($method eq 'POST') {
      if ($origin eq '') { text($c, 400, 'no origin'); return }
      $prefs{$key} //= {};
      $prefs{$key}{history} = (($q->{history} // '') eq '1') ? 1 : 0 if defined $q->{history};
    }
    my $hist = ($prefs{$key} && $prefs{$key}{history}) ? 1 : 0;
    send_($c, 200, 'application/json', "{\"history\":$hist}"); return;
  }
  if ($method eq 'POST' && $path eq '/open-external') {
    # the view's own "open in browser" control: the address is built here from a known project key, never taken
    # from the request, and handed to the system browser
    my $key = $q->{p} // '';
    if ($origin eq '' || $key eq '' || !$projects{$key}) { text($c, 400, 'unknown project'); return }
    openExternal("http://localhost:$port/p/" . escapeData($key) . '/');
    text($c, 200, 'opened'); return;
  }
  if ($method eq 'POST' && ($path eq '/push' || $path eq '/ping')) {
    my ($key, $sid, $inst) = ($q->{p} // '', $q->{s} // '', $q->{i} // '');
    if ($key eq '' || $sid eq '' || $inst eq '') { text($c, 400, 'p, s and i are required'); return }
    my $pr = project($key, $q->{name});
    my $now = time;
    my $se = $pr->{sessions}{$sid};
    # the first instance owns a session; another may take over once the owner has been silent for 30 s
    if ($se && $se->{inst} ne $inst && $now - $se->{last} < 30) { text($c, 409, 'another copy owns this session'); return }
    if (!$se || $se->{inst} ne $inst) {
      # a new instance replays the session from its transcript: drop what the old one sent, and make pages refetch
      if (grep { $_ eq $sid } @{ $pr->{owner} }) {
        my (@raw, @owner);
        for my $k (0 .. $#{ $pr->{raw} }) { if ($pr->{owner}[$k] ne $sid) { push @raw, $pr->{raw}[$k]; push @owner, $pr->{owner}[$k] } }
        $pr->{raw} = \@raw; $pr->{owner} = \@owner;
        my $e = nowMs(); $pr->{epoch} = $pr->{epoch} + 1 > $e ? $pr->{epoch} + 1 : $e;
      }
      $pr->{sessions}{$sid} = { inst => $inst, last => $now, count => 0 };
    } else { $se->{last} = $now }
    $se = $pr->{sessions}{$sid};
    $lastPing = $now;
    if ($path eq '/push') {
      # the session says how many of its lines it believes we hold (from): lines we already have are skipped, so a
      # replay after a lost connection never duplicates; if it believes we hold more than we do, it must replay
      my $from = int($q->{from} // 0);
      if ($from > $se->{count}) { text($c, 410, 'replay from the start'); return }
      my $skip = $se->{count} - $from;
      for my $ln (split(/\n/, $r->{body})) {
        $ln =~ s/\s+$//;
        # only a JSON object is kept, so one bad line can never break the stream for every page
        next if length($ln) < 2 || substr($ln, 0, 1) ne '{' || substr($ln, -1) ne '}';
        my $ok = eval { my $o = $json->decode($ln); ref($o) eq 'HASH' };
        next unless $ok;
        if ($skip > 0) { $skip--; next }
        push @{ $pr->{raw} }, $ln;
        push @{ $pr->{owner} }, $sid;
        $se->{count}++;
      }
      $pr->{last} = $now;
      # bounded memory: a project keeps its last 20000 lines; dropping older ones renumbers the stream, so the
      # epoch changes (pages refetch); a session's held count still counts the dropped lines, so a replay skips them
      if (@{ $pr->{raw} } > 20000) {
        my $cut = @{ $pr->{raw} } - 20000;
        splice(@{ $pr->{raw} }, 0, $cut); splice(@{ $pr->{owner} }, 0, $cut);
        my $e = nowMs(); $pr->{epoch} = $pr->{epoch} + 1 > $e ? $pr->{epoch} + 1 : $e;
      }
    }
    text($c, 200, scalar(@{ $pr->{raw} })); return;
  }
  if ($path =~ m{^/p/([^/]+)/events$}) {
    my $pr = $projects{$1};
    if (!$pr) { send_($c, 200, 'application/json', '{"epoch":0,"total":0,"events":[]}'); return }
    my $since = ($q->{since} // '') =~ /^\d+$/ ? int($q->{since}) : 0;
    my $count = scalar(@{ $pr->{raw} });
    # an event's seq is its position in the stream, 1..n, so the first one past since is at index since
    my $lo = $since < $count ? $since : $count;
    my $n = $count - $lo; $n = 2000 if $n > 2000;
    my @parts;
    for my $k ($lo .. $lo + $n - 1) { push @parts, '{"seq":' . ($k + 1) . ',' . substr($pr->{raw}[$k], 1) }
    send_($c, 200, 'application/json', "{\"epoch\":$pr->{epoch},\"total\":$count,\"events\":[" . join(',', @parts) . ']}'); return;
  }
  if ($method eq 'GET') {
    my $rel = $path; $rel =~ s{^/+}{};
    # the root opens the project worked on most recently; /projects lists them all
    if ($rel eq '' && keys %projects) {
      my ($latest) = sort { $projects{$b}{last} <=> $projects{$a}{last} } keys %projects;
      redirect($c, '/p/' . escapeData($latest) . '/'); return;
    }
    if ($rel eq '' || $rel eq 'projects') { my $b = indexHtml(); utf8::encode($b) if utf8::is_utf8($b); send_($c, 200, 'text/html; charset=utf-8', $b); return }
    if ($rel =~ m{^p/[^/]+/?$}) {
      if ($rel !~ m{/$}) { redirect($c, "/$rel/"); return }
      $rel = 'index.html';
    } elsif ($rel =~ m{^p/[^/]+/(.+)$}) { $rel = $1 }
    # only plain files inside the web folder, never a script of the server's own, never a path that climbs out
    if ($rel =~ /\\/ || $rel =~ m{(^|/)\.\.(/|$)} || $rel =~ /\.(pl|ps1)$/) { text($c, 404, 'not found'); return }
    my $file = File::Spec->catfile($rootFull, split(m{/}, $rel));
    my $real = -f $file ? abs_path($file) : undef;
    if ($real && index($real, $rootFull . '/') == 0 && -f $real) {
      my ($ext) = $real =~ /(\.[A-Za-z0-9]+)$/;
      my $type = $types{ lc($ext // '') } // 'application/octet-stream';
      open(my $fh, '<:raw', $real) or do { text($c, 404, 'not found'); return };
      local $/; my $data = <$fh>; close $fh;
      send_($c, 200, $type, $data); return;
    }
    text($c, 404, 'not found'); return;
  }
  text($c, 405, 'no');
}

# ---------- the loop: one request at a time, the idle exit checked every few seconds ----------
my $sel = IO::Select->new(@listeners);
while (1) {
  my @ready = $sel->can_read(5);
  if (time - $lastPing > 600) { last }
  for my $l (@ready) {
    my $c = $l->accept or next;
    eval { handle($c) };
    close($c);
  }
}
close($_) for @listeners;
flock($lock, LOCK_UN); close($lock);
exit 0;
