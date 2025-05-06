import os
from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory
from flask_cors import CORS
import openai
import base64
import json
import numpy as np
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

app = Flask(__name__, static_folder='static')
CORS(app)

# 配置OpenAI客户端 v0.28.0版本
openai.api_key = os.getenv("DASHSCOPE_API_KEY") or "sk-xxx"  # 如果没有环境变量，请替换为您的API密钥
openai.api_base = "https://dashscope.aliyuncs.com/compatible-mode/v1"

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        # 从请求中获取数据
        data = request.get_json()
        audio_data = data.get('audio')
        text_input = data.get('text', '')
        
        if not audio_data and not text_input:
            return jsonify({"error": "未提供输入"}), 400
        
        # 为v0.28.0 API准备消息结构
        messages = []
        
        if text_input:
            # 如果有文本输入，使用文本作为消息内容
            messages.append({"role": "user", "content": text_input})
        elif audio_data:
            # 对于音频，我们包含一个占位符消息
            messages.append({"role": "user", "content": "[音频输入]"})
        
        def generate():
            try:
                # 调用API
                response = openai.ChatCompletion.create(
                    model="qwen-omni-turbo-0119",
                    messages=messages,
                    stream=True,
                    # Qwen API特定参数
                    modalities=["text", "audio"],
                    audio={"voice": "Cherry", "format": "wav"}
                )
                
                # 用于收集音频数据的列表
                audio_chunks = []
                
                for chunk in response:
                    # 提取流中的内容
                    if 'choices' in chunk:
                        choice = chunk['choices'][0]
                        
                        # 处理文本内容
                        if 'delta' in choice and 'content' in choice['delta'] and choice['delta']['content']:
                            content = choice['delta']['content']
                            # 安全地创建JSON并发送
                            json_data = json.dumps({'type': 'text', 'content': content})
                            yield f"data: {json_data}\n\n"
                        
                        # 处理音频数据
                        if 'delta' in choice and 'audio' in choice['delta']:
                            try:
                                # 处理音频数据
                                if 'data' in choice['delta']['audio']:
                                    audio_data = choice['delta']['audio']['data']
                                    # 收集音频数据
                                    audio_chunks.append(audio_data)
                                    
                                    # 每收集10个块发送一次，以减少HTTP请求数量
                                    if len(audio_chunks) >= 10:
                                        # 合并音频数据
                                        combined_audio = ''.join(audio_chunks)
                                        # 清空收集列表
                                        audio_chunks.clear()
                                        # 发送合并后的音频数据
                                        json_data = json.dumps({'type': 'audio', 'content': combined_audio})
                                        yield f"data: {json_data}\n\n"
                                
                                # 处理转录文本
                                if 'transcript' in choice['delta']['audio']:
                                    transcript = choice['delta']['audio']['transcript']
                                    # 创建JSON并发送
                                    json_data = json.dumps({'type': 'transcript', 'content': transcript})
                                    yield f"data: {json_data}\n\n"
                            except Exception as e:
                                # 记录错误并发送错误信息
                                error_msg = f"音频处理错误: {str(e)}"
                                print(error_msg)
                                json_data = json.dumps({'type': 'error', 'content': error_msg})
                                yield f"data: {json_data}\n\n"
                
                # 最后发送剩余的音频数据
                if audio_chunks:
                    combined_audio = ''.join(audio_chunks)
                    json_data = json.dumps({'type': 'audio', 'content': combined_audio})
                    yield f"data: {json_data}\n\n"
                    
            except Exception as e:
                # 处理API调用错误
                error_msg = f"API错误: {str(e)}"
                print(error_msg)
                json_data = json.dumps({'type': 'error', 'content': error_msg})
                yield f"data: {json_data}\n\n"
                
        return Response(stream_with_context(generate()), content_type='text/event-stream')
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/text-only', methods=['POST'])
def text_only_chat():
    """纯文本交互的端点"""
    try:
        data = request.get_json()
        text_input = data.get('text', '')
        
        if not text_input:
            return jsonify({"error": "未提供文本输入"}), 400
        
        def generate():
            try:
                # 调用API
                response = openai.ChatCompletion.create(
                    model="qwen-omni-turbo-0119",
                    messages=[{"role": "user", "content": text_input}],
                    stream=True,
                    # Qwen API特定参数
                    modalities=["text", "audio"],
                    audio={"voice": "Cherry", "format": "wav"}
                )
                
                # 用于收集音频数据的列表
                audio_chunks = []
                
                for chunk in response:
                    # 提取流中的内容
                    if 'choices' in chunk:
                        choice = chunk['choices'][0]
                        
                        # 处理文本内容
                        if 'delta' in choice and 'content' in choice['delta'] and choice['delta']['content']:
                            content = choice['delta']['content']
                            # 安全地创建JSON并发送
                            json_data = json.dumps({'type': 'text', 'content': content})
                            yield f"data: {json_data}\n\n"
                        
                        # 处理音频数据
                        if 'delta' in choice and 'audio' in choice['delta']:
                            try:
                                # 处理音频数据
                                if 'data' in choice['delta']['audio']:
                                    audio_data = choice['delta']['audio']['data']
                                    # 收集音频数据
                                    audio_chunks.append(audio_data)
                                    
                                    # 每收集10个块发送一次，以减少HTTP请求数量
                                    if len(audio_chunks) >= 10:
                                        # 合并音频数据
                                        combined_audio = ''.join(audio_chunks)
                                        # 清空收集列表
                                        audio_chunks.clear()
                                        # 发送合并后的音频数据
                                        json_data = json.dumps({'type': 'audio', 'content': combined_audio})
                                        yield f"data: {json_data}\n\n"
                                
                                # 处理转录文本
                                if 'transcript' in choice['delta']['audio']:
                                    transcript = choice['delta']['audio']['transcript']
                                    # 创建JSON并发送
                                    json_data = json.dumps({'type': 'transcript', 'content': transcript})
                                    yield f"data: {json_data}\n\n"
                            except Exception as e:
                                # 记录错误并发送错误信息
                                error_msg = f"音频处理错误: {str(e)}"
                                print(error_msg)
                                json_data = json.dumps({'type': 'error', 'content': error_msg})
                                yield f"data: {json_data}\n\n"
                
                # 最后发送剩余的音频数据
                if audio_chunks:
                    combined_audio = ''.join(audio_chunks)
                    json_data = json.dumps({'type': 'audio', 'content': combined_audio})
                    yield f"data: {json_data}\n\n"
                    
            except Exception as e:
                # 处理API调用错误
                json_data = json.dumps({'type': 'error', 'content': str(e)})
                yield f"data: {json_data}\n\n"
                
        return Response(stream_with_context(generate()), content_type='text/event-stream')
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # 在局域网内访问，使用'0.0.0.0'而不是'localhost'
    app.run(host='0.0.0.0', port=5000, debug=True)
