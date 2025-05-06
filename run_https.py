#!/usr/bin/env python
import os
import ssl
from app import app
from gevent.pywsgi import WSGIServer

# 检查证书文件是否存在
cert_path = 'cert.pem'
key_path = 'key.pem'

if not (os.path.exists(cert_path) and os.path.exists(key_path)):
    print("错误: 证书文件不存在。请先生成证书文件。")
    print("生成命令示例: openssl req -x509 -newkey rsa:4096 -nodes -out cert.pem -keyout key.pem -days 365")
    exit(1)

# 设置SSL上下文
ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
ssl_context.load_cert_chain(certfile=cert_path, keyfile=key_path)

# 创建HTTPS服务器
http_server = WSGIServer(('0.0.0.0', 5000), app, ssl_context=ssl_context)

print("启动HTTPS服务器于 https://0.0.0.0:5000")
print("在Windows电脑上访问 https://你的服务器IP:5000")
http_server.serve_forever()
