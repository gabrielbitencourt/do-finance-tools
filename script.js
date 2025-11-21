if ($response.headers['Content-Type'] && $response.headers['Content-Type'] == 'text/html') {
  $done({ body: $response.body.replace('</body>', '<script src="/register-sw.js"></script><script src="/custom-sw.js"></script></body>') })
}
else $done({})
