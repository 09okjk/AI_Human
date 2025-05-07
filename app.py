import os
from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory
from flask_cors import CORS
import openai
import base64
import json
import numpy as np
from dotenv import load_dotenv
import ssl

# Load environment variables
load_dotenv()

app = Flask(__name__, static_folder='static')
CORS(app)

# 获取SSL证书文件路径
cert_path = os.path.join(os.path.dirname(__file__), 'cert.pem')
key_path = os.path.join(os.path.dirname(__file__), 'key.pem')

# Configure OpenAI client for v0.28.0
openai.api_key = os.getenv("DASHSCOPE_API_KEY") or "sk-xxx"  # Replace with your API key if not using env var
openai.api_base = "https://dashscope.aliyuncs.com/compatible-mode/v1"

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

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
        
        if text_input and audio_data:
            # 处理文本+音频的情况
            # 从 base64 数据中提取真正的编码部分
            if audio_data.startswith('data:audio/wav;base64,'):
                audio_data = audio_data[len('data:audio/wav;base64,'):]
                
            messages.append({
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": audio_data,
                            "format": "wav"
                        }
                    },
                    {"type": "text", "text": text_input}
                ]
            })
        elif text_input:
            # 只有文本
            messages.append({"role": "user", "content": text_input})
        elif audio_data:
            # 只有音频
            # 从 base64 数据中提取真正的编码部分
            if audio_data.startswith('data:audio/wav;base64,'):
                audio_data = audio_data[len('data:audio/wav;base64,'):]
                
            messages.append({
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": audio_data,
                            "format": "wav"
                        }
                    }
                ]
            })  
        
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
