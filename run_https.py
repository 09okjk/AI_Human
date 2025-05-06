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

# 设置SSL上下文 - 使用更宽松的配置
ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
# 允许所有版本的TLS
ssl_context.options &= ~ssl.OP_NO_TLSv1
ssl_context.options &= ~ssl.OP_NO_TLSv1_1

# 加载证书
ssl_context.load_cert_chain(certfile=cert_path, keyfile=key_path)

# 根据需要禁用证书验证
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

# 创建HTTPS服务器
http_server = WSGIServer(('0.0.0.0', 5000), app, ssl_context=ssl_context)

print("启动HTTPS服务器于 https://0.0.0.0:5000")
print("在Windows电脑上访问 https://你的服务器IP:5000")
http_server.serve_forever()
