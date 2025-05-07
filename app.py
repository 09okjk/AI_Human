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
        
        # For v0.28.0, we need to handle multimodal content differently
        # Since v0.28.0 doesn't natively support multimodal inputs like audio,
        # we'll need to adapt our approach
        
        if text_input:
            # If we have text, use it as the message content
            messages.append({"role": "user", "content": text_input})
        elif audio_data:
            # For audio, we'll include a placeholder message and send audio separately
            messages.append({"role": "user", "content": "[Audio Input]"})  
        
        def generate():
            try:
                # Using v0.28.0 API structure
                response = openai.ChatCompletion.create(
                    model="qwen-omni-turbo-0119",
                    messages=messages,
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
