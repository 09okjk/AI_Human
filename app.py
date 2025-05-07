import os
import time
import uuid
from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory, url_for
from flask_cors import CORS
import openai
import base64
import json
import numpy as np
from dotenv import load_dotenv
import ssl
from pathlib import Path

# Load environment variables
load_dotenv()

app = Flask(__name__, static_folder='static')
CORS(app)

# 获取SSL证书文件路径
cert_path = os.path.join(os.path.dirname(__file__), 'cert.pem')
key_path = os.path.join(os.path.dirname(__file__), 'key.pem')

# 创建音频上传目录
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads', 'audio')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Configure OpenAI client for v0.28.0
openai.api_key = os.getenv("DASHSCOPE_API_KEY") or "sk-xxx"  # Replace with your API key if not using env var
openai.api_base = "https://dashscope.aliyuncs.com/compatible-mode/v1"

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/uploads/audio/<filename>')
def serve_audio(filename):
    """提供上传的音频文件访问"""
    return send_from_directory(UPLOAD_FOLDER, filename)

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        # Get audio data from request
        data = request.get_json()
        audio_data = data.get('audio')
        text_input = data.get('text', '')
        
        if not audio_data and not text_input:
            return jsonify({"error": "No input provided"}), 400
        
        # For v0.28.0 API structure
        messages = []  # Will prepare messages based on input
        
        # 处理多模态输入（文本和音频）
        # 根据官方文档，音频需要特定的格式
        
        # 处理音频数据（如果有）
        audio_url = None
        if audio_data:
            try:
                # 从 base64 数据中提取真正的编码部分
                if audio_data.startswith('data:audio/wav;base64,'):
                    audio_data = audio_data[len('data:audio/wav;base64,'):]
                
                # 解码base64数据
                audio_binary = base64.b64decode(audio_data)
                
                # 生成唯一文件名
                filename = f"{uuid.uuid4()}.wav"
                file_path = os.path.join(UPLOAD_FOLDER, filename)
                
                # 写入文件
                with open(file_path, 'wb') as f:
                    f.write(audio_binary)
                
                # 生成音频文件URL - 使用完整的URL包含主机名
                server_name = request.headers.get('Host', '192.168.18.197:8443')
                protocol = 'https'
                audio_url = f"{protocol}://{server_name}/uploads/audio/{filename}"
                
                print(f"\n已保存音频文件: {file_path}")
                print(f"\n音频URL: {audio_url}")
                
            except Exception as e:
                print(f"\n处理音频数据时出错: {e}")
        
        # 准备内容数组
        content_array = []
        
        # 添加文本和音频内容
        if text_input and audio_url:
            # 文本+音频
            content_array = [
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": audio_url,
                        "format": "wav"
                    }
                },
                {"type": "text", "text": text_input}
            ]
            messages.append({"role": "user", "content": content_array})
            print(f"\n发送文本+音频消息: {text_input} + {audio_url}")
            
        elif text_input:
            # 只有文本
            messages.append({"role": "user", "content": text_input})
            print(f"\n发送纯文本消息: {text_input}")
            
        elif audio_url:
            # 只有音频
            content_array = [
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": audio_url,
                        "format": "wav"
                    }
                }
            ]
            messages.append({"role": "user", "content": content_array})
            print(f"\n发送纯音频消息: {audio_url}")
            
        else:
            # 无效输入情况
            messages.append({"role": "user", "content": "请提供文字或语音输入"})
            print("\n没有有效输入内容")  
        
        def generate():
            try:
                # 使用 v0.28.0 API 结构与 Qwen-Omni 特定参数
                print("\n发送到API的消息结构:", json.dumps(messages, ensure_ascii=False))
                response = openai.ChatCompletion.create(
                    model="qwen-omni-turbo-0119",
                    messages=messages,
                    stream=True,
                    # 配置 Qwen API 特定参数
                    modalities=["text", "audio"],
                    audio={"voice": "Cherry", "format": "wav"},
                    # 添加流选项以包含 usage 信息
                    stream_options={"include_usage": True}
                )
                
                for chunk in response:
                    # Extract content from the stream
                    if 'choices' in chunk:
                        choice = chunk['choices'][0]
                        if 'delta' in choice and 'content' in choice['delta'] and choice['delta']['content']:
                            # Text content
                            yield f"data: {json.dumps({'type': 'text', 'content': choice['delta']['content']})}\n\n"
                        
                        # Check for audio data in a manner compatible with Dashscope API
                        if 'delta' in choice and 'audio' in choice['delta']:
                            try:
                                audio_data = choice['delta']['audio']['data']
                                yield f"data: {json.dumps({'type': 'audio', 'content': audio_data})}\n\n"
                            except Exception as e:
                                # Try to get transcript if available
                                if 'transcript' in choice['delta']['audio']:
                                    transcript = choice['delta']['audio']['transcript']
                                    yield f"data: {json.dumps({'type': 'transcript', 'content': transcript})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
                
        return Response(stream_with_context(generate()), content_type='text/event-stream')
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/text-only', methods=['POST'])
def text_only_chat():
    """Endpoint for text-only interactions"""
    try:
        data = request.get_json()
        text_input = data.get('text', '')
        
        if not text_input:
            return jsonify({"error": "No text input provided"}), 400
        
        def generate():
            try:
                # Using v0.28.0 API structure
                response = openai.ChatCompletion.create(
                    model="qwen-omni-turbo-0119",
                    messages=[{"role": "user", "content": text_input}],
                    stream=True,
                    # Additional parameters specific to Qwen API
                    modalities=["text", "audio"],
                    audio={"voice": "Cherry", "format": "wav"}
                )
                
                for chunk in response:
                    # Extract content from the stream
                    if 'choices' in chunk:
                        choice = chunk['choices'][0]
                        if 'delta' in choice and 'content' in choice['delta'] and choice['delta']['content']:
                            # Text content
                            yield f"data: {json.dumps({'type': 'text', 'content': choice['delta']['content']})}\n\n"
                        
                        # Check for audio data in a manner compatible with Dashscope API
                        if 'delta' in choice and 'audio' in choice['delta']:
                            try:
                                audio_data = choice['delta']['audio']['data']
                                yield f"data: {json.dumps({'type': 'audio', 'content': audio_data})}\n\n"
                            except Exception as e:
                                # Try to get transcript if available
                                if 'transcript' in choice['delta']['audio']:
                                    transcript = choice['delta']['audio']['transcript']
                                    yield f"data: {json.dumps({'type': 'transcript', 'content': transcript})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            
        return Response(stream_with_context(generate()), content_type='text/event-stream')
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # 设置HTTPS参数
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    
    # 允许所有TLS版本，提高兼容性
    ssl_context.options &= ~ssl.OP_NO_TLSv1
    ssl_context.options &= ~ssl.OP_NO_TLSv1_1
    
    # 加载证书
    ssl_context.load_cert_chain(cert_path, key_path)
    
    # 禁用主机名检查，避免证书验证问题
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    
    print("\n启动HTTPS服务器于 https://0.0.0.0:8443")
    print("在Windows电脑上访问 https://{}:8443 (请替换为你的服务器IP)\n".format("192.168.18.197"))
    
    # 直接使用Flask运行HTTPS服务器
    app.run(
        host='0.0.0.0', 
        port=8443, 
        debug=True,
        ssl_context=ssl_context
    )
