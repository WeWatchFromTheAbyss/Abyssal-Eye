# The Abyssal Eye's local server, shared by every Claude session on this machine.
# Each project has one view at /p/<key>/ and one event stream; sessions POST raw JSON lines to
# /push?p=<key>&s=<session>&i=<instance>, the server numbers them, the page polls /p/<key>/events?since=<seq>.
# One plugin instance owns a session's stream at a time (a second copy of the plugin in the same session is refused).
# Exits once no session has pushed or pinged for a while.
# Loopback only: any client that is not this machine is refused, and a POST carrying an Origin header (a web page
# rather than the plugin) is refused, so no site in a browser can push into or read a stream.
param([string]$Root, [int]$Port = 7311)

# one server per machine: sessions that start together may each launch one, and only the first stays
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\AbyssalEyeServer', [ref]$created)
if (-not $created) { exit 0 }

$listener = $null
for ($p = $Port; $p -lt $Port + 30; $p++) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Prefixes.Add("http://127.0.0.1:$p/")
    try { $l.Prefixes.Add("http://[::1]:$p/") } catch { }
    $l.Start()
    $listener = $l
    $Port = $p
    break
  } catch { }
}
if (-not $listener) { exit 1 }

$version = 'abyssal-eye-server 4'
$projects = @{}
$lastPing = [DateTime]::UtcNow
$lastCheck = [DateTime]::UtcNow
$utf8 = New-Object System.Text.UTF8Encoding($false)
$types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css'; '.svg' = 'image/svg+xml'; '.png' = 'image/png' }
$rootFull = [IO.Path]::GetFullPath($Root)

function Send($ctx, [int]$status, [string]$type, [byte[]]$body) {
  $r = $ctx.Response
  $r.StatusCode = $status
  $r.ContentType = $type
  $r.Headers.Add('Cache-Control', 'no-store')
  $r.ContentLength64 = $body.Length
  # a client that stops reading must not hang the loop
  $w = $r.OutputStream.BeginWrite($body, 0, $body.Length, $null, $null)
  if ($w.AsyncWaitHandle.WaitOne(4000)) { $r.OutputStream.EndWrite($w); $r.Close() } else { $r.Abort() }
}

function Text($ctx, [int]$status, [string]$s) { Send $ctx $status 'text/plain; charset=utf-8' $utf8.GetBytes($s) }

function Project([string]$key, [string]$name) {
  if (-not $projects.ContainsKey($key)) {
    $projects[$key] = @{
      name = $name; epoch = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      raw = New-Object 'System.Collections.Generic.List[string]'; owner = New-Object 'System.Collections.Generic.List[string]'
      sessions = @{}; last = [DateTime]::UtcNow
    }
  }
  $pr = $projects[$key]
  if ($name) { $pr.name = $name }
  return $pr
}

function Html([string]$s) { return [Net.WebUtility]::HtmlEncode($s) }

function Index() {
  $rows = ''
  foreach ($k in ($projects.Keys | Sort-Object { $projects[$_].last } -Descending)) {
    $pr = $projects[$k]
    $live = @($pr.sessions.Values | Where-Object { ([DateTime]::UtcNow - $_.last).TotalSeconds -lt 90 }).Count
    $rows += "<li><a href=""/p/$(Html $k)/"">$(Html $pr.name)</a><span>$live live session$(if ($live -ne 1) { 's' })</span></li>"
  }
  if (-not $rows) { $rows = '<li><span>No projects yet. Start Claude Code in a project.</span></li>' }
  return "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Abyssal Eye</title>" +
    "<style>body{margin:0;background:#1C2321;color:#DCD2B0;font:15px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}main{max-width:560px;margin:12vh auto;padding:0 16px}" +
    "h1{font-weight:500;font-size:18px;color:#A8843A}ul{list-style:none;padding:0}li{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2A2E2A}" +
    "a{color:#DCD2B0;text-decoration:none}a:hover{color:#4FB3BF}span{color:#7E7A68}</style><main><h1>Abyssal Eye</h1><ul>$rows</ul></main>"
}

$pending = $listener.BeginGetContext($null, $null)
while ($listener.IsListening) {
  $ready = $pending.AsyncWaitHandle.WaitOne(5000)
  if (([DateTime]::UtcNow - $lastCheck).TotalSeconds -ge 5) {
    $lastCheck = [DateTime]::UtcNow
    if (([DateTime]::UtcNow - $lastPing).TotalSeconds -gt 600) { break }
  }
  if (-not $ready) { continue }
  $ctx = $listener.EndGetContext($pending)
  $pending = $listener.BeginGetContext($null, $null)
  try {
    $req = $ctx.Request
    if (-not $req.RemoteEndPoint -or -not [Net.IPAddress]::IsLoopback($req.RemoteEndPoint.Address)) { Text $ctx 403 'loopback only'; continue }
    if ($req.HttpMethod -eq 'POST' -and $req.Headers['Origin']) { Text $ctx 403 'no cross-site posts'; continue }
    $path = $req.Url.AbsolutePath
    $q = $req.QueryString
    if ($path -eq '/hello') {
      Text $ctx 200 $version
    } elseif ($path -match '^/p/[^/]+/version$') {
      # changes whenever the page's files change, so open pages can reload themselves
      $stamp = 0
      foreach ($f in 'index.html', 'core.js', 'layout.js', 'draw.js', 'main.js') { $fp = Join-Path $Root $f; if (Test-Path $fp) { $stamp += (Get-Item $fp).LastWriteTimeUtc.Ticks } }
      Text $ctx 200 ([string]$stamp)
    } elseif ($req.HttpMethod -eq 'POST' -and ($path -eq '/push' -or $path -eq '/ping')) {
      $key = [string]$q['p']; $sid = [string]$q['s']; $inst = [string]$q['i']
      if (-not $key -or -not $sid -or -not $inst) { Text $ctx 400 'p, s and i are required'; continue }
      $pr = Project $key ([string]$q['name'])
      $now = [DateTime]::UtcNow
      $se = $pr.sessions[$sid]
      # the first instance owns a session; another may take over once the owner has been silent for 30 s
      if ($se -and $se.inst -ne $inst -and ($now - $se.last).TotalSeconds -lt 30) { Text $ctx 409 'another copy owns this session'; continue }
      if (-not $se -or $se.inst -ne $inst) {
        # a new instance replays the session from its transcript: drop what the old one sent, and make pages refetch
        if ($pr.owner.Contains($sid)) {
          $keepRaw = New-Object 'System.Collections.Generic.List[string]'; $keepOwner = New-Object 'System.Collections.Generic.List[string]'
          for ($k = 0; $k -lt $pr.raw.Count; $k++) { if ($pr.owner[$k] -ne $sid) { $keepRaw.Add($pr.raw[$k]); $keepOwner.Add($pr.owner[$k]) } }
          $pr.raw = $keepRaw; $pr.owner = $keepOwner
          $pr.epoch = [Math]::Max($pr.epoch + 1, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
        }
        $pr.sessions[$sid] = @{ inst = $inst; last = $now; count = 0 }
      } else { $se.last = $now }
      $se = $pr.sessions[$sid]
      $lastPing = $now
      if ($path -eq '/push') {
        # the session says how many of its lines it believes we hold (from): lines we already have are skipped, so a
        # replay after a lost connection never duplicates; if it believes we hold more than we do, it must replay
        $reader = New-Object System.IO.StreamReader($req.InputStream, $utf8)
        $text = $reader.ReadToEnd()
        $from = 0
        if ($q['from']) { try { $from = [int]$q['from'] } catch { $from = 0 } }
        if ($from -gt $se.count) { Text $ctx 410 'replay from the start'; continue }
        $skip = $se.count - $from
        foreach ($ln in $text.Split("`n")) {
          $ln = $ln.TrimEnd()
          # only a JSON object is kept, so one bad line can never break the stream for every page
          if ($ln.Length -lt 2 -or $ln[0] -ne '{' -or $ln[$ln.Length - 1] -ne '}') { continue }
          try { $null = ConvertFrom-Json $ln -ErrorAction Stop } catch { continue }
          if ($skip -gt 0) { $skip--; continue }
          $pr.raw.Add($ln)
          $pr.owner.Add($sid)
          $se.count++
        }
        $pr.last = $now
        # bounded memory: a project keeps its last 20000 lines; dropping older ones renumbers the stream, so the
        # epoch changes (pages refetch); a session's held count still counts the dropped lines, so a replay skips them
        if ($pr.raw.Count -gt 20000) {
          $cut = $pr.raw.Count - 20000
          $pr.raw.RemoveRange(0, $cut); $pr.owner.RemoveRange(0, $cut)
          $pr.epoch = [Math]::Max($pr.epoch + 1, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
        }
      }
      Text $ctx 200 ([string]$pr.raw.Count)
    } elseif ($path -match '^/p/([^/]+)/events$') {
      $pr = $projects[$Matches[1]]
      if (-not $pr) { Send $ctx 200 'application/json' $utf8.GetBytes('{"epoch":0,"events":[]}'); continue }
      $since = 0
      [long]::TryParse($q['since'], [ref]$since) | Out-Null
      # an event's seq is its position in the stream, 1..n, so the first one past since is at index since
      $lo = [int][Math]::Max(0, [Math]::Min($since, $pr.raw.Count))
      $n = [Math]::Min($pr.raw.Count - $lo, 2000)
      $sb = New-Object System.Text.StringBuilder
      [void]$sb.Append('{"epoch":').Append($pr.epoch).Append(',"events":[')
      for ($k = $lo; $k -lt $lo + $n; $k++) {
        if ($k -gt $lo) { [void]$sb.Append(',') }
        [void]$sb.Append('{"seq":').Append($k + 1).Append(',').Append($pr.raw[$k], 1, $pr.raw[$k].Length - 1)
      }
      $body = $sb.Append(']}').ToString()
      Send $ctx 200 'application/json' $utf8.GetBytes($body)
    } elseif ($req.HttpMethod -eq 'GET') {
      $rel = $path.TrimStart('/')
      # the root opens the project worked on most recently; /projects lists them all
      if ($rel -eq '' -and $projects.Count -gt 0) {
        $latest = $projects.Keys | Sort-Object { $projects[$_].last } -Descending | Select-Object -First 1
        $ctx.Response.Redirect('/p/' + $latest + '/'); $ctx.Response.Close(); continue
      }
      if ($rel -eq '' -or $rel -eq 'projects') { Send $ctx 200 'text/html; charset=utf-8' $utf8.GetBytes((Index)); continue }
      if ($rel -match '^p/[^/]+/?$') {
        if (-not $rel.EndsWith('/')) { $ctx.Response.Redirect('/' + $rel + '/'); $ctx.Response.Close(); continue }
        $rel = 'index.html'
      } elseif ($rel -match '^p/[^/]+/(.+)$') { $rel = $Matches[1] }
      $file = [IO.Path]::GetFullPath((Join-Path $Root $rel))
      if ($file.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar) -and (Test-Path $file -PathType Leaf) -and -not $file.EndsWith('.ps1')) {
        $type = $types[[IO.Path]::GetExtension($file)]
        if (-not $type) { $type = 'application/octet-stream' }
        Send $ctx 200 $type ([IO.File]::ReadAllBytes($file))
      } else { Text $ctx 404 'not found' }
    } else { Text $ctx 405 'no' }
  } catch {
    try { $ctx.Response.Abort() } catch { }
  }
}
$listener.Stop()
$mutex.ReleaseMutex()
