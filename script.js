if ($request.headers['Content-Type'] && $request.headers['Content-Type'] == 'text/html') {
  $done({ body: $request.body.replace('</body>', '<script src="/register-sw.js"></script><script src="/custom-sw.js"></script></body>') })
}
else $done({})