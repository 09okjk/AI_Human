import os
import time
import uuid
from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory, url_for, session
from flask_cors import CORS
import openai
import base64
import json
import numpy as np
from dotenv import load_dotenv
import ssl
from pathlib import Path
import threading
import queue

# Load environment variables
load_dotenv()

app = Flask(__name__, static_folder='static')
app.secret_key = os.urandom(24)  # 为会话管理添加密钥
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

# 活跃通话会话管理
active_calls = {}
interrupt_flags = {}

# 会话超时时间（分钟）
SESSION_TIMEOUT = 10

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/uploads/audio/<filename>')
def serve_audio(filename):
    """提供上传的音频文件访问"""
    return send_from_directory(UPLOAD_FOLDER, filename)

@app.route('/api/call/start', methods=['POST'])
def start_call():
    """开始一个新的语音通话会话"""
    session_id = str(uuid.uuid4())
    active_calls[session_id] = {
        'messages': [],  # 存储对话历史
        'start_time': time.time(),
        'last_activity': time.time(),
        'is_speaking': False,  # AI是否正在说话
    }
    interrupt_flags[session_id] = False
    
    return jsonify({
        'session_id': session_id,
        'status': 'started',
        'message': '通话已开始，请开始对话'
    })

@app.route('/api/call/end', methods=['POST'])
def end_call():
    """结束一个语音通话会话"""
    data = request.get_json()
    session_id = data.get('session_id')
    
    if session_id in active_calls:
        # 清理相关资源
        active_calls.pop(session_id, None)
        interrupt_flags.pop(session_id, None)
        
        return jsonify({
            'status': 'ended',
            'message': '通话已结束'
        })
    else:
        return jsonify({
            'status': 'error',
            'message': '找不到指定的通话会话'
        }), 404

@app.route('/api/call/interrupt', methods=['POST'])
def interrupt_call():
    """打断当前AI语音回复"""
    data = request.get_json()
    session_id = data.get('session_id')
    
    if session_id in active_calls:
        # 设置打断标志
        interrupt_flags[session_id] = True
        return jsonify({
            'status': 'interrupted',
            'message': '已发送打断信号'
        })
    else:
        return jsonify({
            'status': 'error',
            'message': '找不到指定的通话会话'
        }), 404

@app.route('/api/voice-chat', methods=['POST'])
def voice_chat():
    """实时语音通话接口"""
    try:
        data = request.get_json()
        audio_data = data.get('audio')
        text_input = data.get('text', '')
        session_id = data.get('session_id')
        vad_result = data.get('vad_status', {})  # 从前端获取VAD状态
        is_final = data.get('is_final', False)  # 是否是一段话的最终部分
        
        # 验证会话
        if not session_id or session_id not in active_calls:
            return jsonify({"error": "无效的会话ID"}), 400
        
        # 更新会话活动时间
        active_calls[session_id]['last_activity'] = time.time()
        
        # 重置打断标志
        interrupt_flags[session_id] = False
        
        # 提取对话历史
        conversation_history = active_calls[session_id]['messages']
        
        # 处理音频和/或文本输入
        clean_audio_data = None
        if audio_data:
            try:
                # 从 base64 数据中提取编码部分
                if audio_data.startswith('data:audio/wav;base64,'):
                    raw_base64 = audio_data[len('data:audio/wav;base64,'):]
                    clean_audio_data = f"data:;base64,{raw_base64}"
                else:
                    clean_audio_data = f"data:;base64,{audio_data}"
                    
                # 保存音频文件（用于调试）
                if clean_audio_data.startswith('data:;base64,'):
                    raw_base64 = clean_audio_data[len('data:;base64,'):]
                else:
                    raw_base64 = clean_audio_data
                    
                audio_binary = base64.b64decode(raw_base64)
                filename = f"{session_id}_{uuid.uuid4()}.wav"
                file_path = os.path.join(UPLOAD_FOLDER, filename)
                
                with open(file_path, 'wb') as f:
                    f.write(audio_binary)
                
                print(f"\n已保存音频文件到: {file_path} (通话会话: {session_id})")
                
            except Exception as e:
                print(f"\n处理音频数据时出错: {e}")
                clean_audio_data = None
        
        # 准备消息内容
        user_message = None
        if text_input and clean_audio_data:
            # 文本+音频混合输入
            content_array = [
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": clean_audio_data,
                        "format": "wav"
                    }
                },
                {"type": "text", "text": text_input}
            ]
            user_message = {"role": "user", "content": content_array}
            print(f"\n发送文本+音频消息: {text_input} + [音频数据]")
            
        elif text_input:
            # 只有文本
            user_message = {"role": "user", "content": text_input}
            print(f"\n发送纯文本消息: {text_input}")
            
        elif clean_audio_data:
            # 只有音频
            content_array = [
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": clean_audio_data,
                        "format": "wav"
                    }
                }
            ]
            user_message = {"role": "user", "content": content_array}
            print(f"\n发送纯音频消息: [音频数据]")
        
        # 如果是最终部分，添加到对话历史
        if is_final and user_message:
            conversation_history.append(user_message)
        
        # 准备发送给API的完整历史消息
        messages = conversation_history.copy()
        if not is_final and user_message:
            # 如果不是最终部分，临时添加当前消息但不保存到历史中
            messages.append(user_message)
            
        def generate():
            try:
                # 标记AI正在说话
                active_calls[session_id]['is_speaking'] = True
                
                # 使用 v0.28.0 API 结构与 Qwen-Omni 特定参数
                print("\n发送到API的消息结构(已省略Base64数据):", 
                      json.dumps([{"role": m.get("role"), 
                                  "content_type": "array" if isinstance(m.get("content"), list) else "text"} 
                                 for m in messages], ensure_ascii=False))
                
                # 调用API
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
                
                collected_response = {"role": "assistant", "content": "", "audio_parts": []}
                
                for chunk in response:
                    # 检查打断标志
                    if interrupt_flags.get(session_id, False):
                        print(f"检测到用户打断，结束AI回复流 (会话: {session_id})")
                        yield f"data: {json.dumps({'type': 'interrupted', 'content': '用户打断了回复'})}\n\n"
                        break
                    
                    # 检查特殊情况：完成通知或结束标记
                    if 'choices' not in chunk:
                        continue
                    
                    # 确保choices列表不为空再访问
                    if not chunk['choices'] or len(chunk['choices']) == 0:
                        continue
                        
                    # 安全地获取choice
                    choice = chunk['choices'][0]
                    
                    # 处理文本内容
                    if 'delta' in choice and 'content' in choice['delta'] and choice['delta']['content']:
                        text_content = choice['delta']['content']
                        collected_response["content"] += text_content
                        yield f"data: {json.dumps({'type': 'text', 'content': text_content})}\n\n"
                    
                    # 处理音频数据
                    if 'delta' in choice and 'audio' in choice['delta']:
                        try:
                            # 尝试获取音频数据
                            if 'data' in choice['delta']['audio']:
                                audio_data = choice['delta']['audio']['data']
                                collected_response["audio_parts"].append(audio_data)
                                yield f"data: {json.dumps({'type': 'audio', 'content': audio_data})}\n\n"
                            # 尝试获取转录文本
                            elif 'transcript' in choice['delta']['audio']:
                                transcript = choice['delta']['audio']['transcript']
                                yield f"data: {json.dumps({'type': 'transcript', 'content': transcript})}\n\n"
                        except Exception as e:
                            print(f"处理音频响应时出错: {e}")
                            continue
                            
                    # 检查是否是最后一个消息
                    if choice.get('finish_reason') is not None:
                        print("流式响应完成，原因:", choice.get('finish_reason'))
                        # 简化音频部分数据存储，避免消息过大
                        if collected_response["audio_parts"]:
                            collected_response["has_audio"] = True
                            collected_response.pop("audio_parts", None)
                        # 添加到对话历史
                        conversation_history.append(collected_response)
            
            except Exception as e:
                print(f"生成响应时发生错误: {e}")
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            finally:
                # 无论如何标记AI已停止说话
                active_calls[session_id]['is_speaking'] = False
                
        return Response(stream_with_context(generate()), content_type='text/event-stream')
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/voice-chat/stream', methods=['POST'])
def voice_chat_stream():
    """获取语音通话响应流"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        
        # 验证会话
        if not session_id or session_id not in active_calls:
            return jsonify({"error": "无效的会话ID"}), 400
            
        # 从会话历史中获取消息
        conversation_history = active_calls[session_id]['messages']
        
        # 准备发送给API的完整历史消息
        messages = conversation_history.copy()
        
        def generate():
            try:
                # 标记AI正在说话
                active_calls[session_id]['is_speaking'] = True
                
                # 使用 v0.28.0 API 结构与 Qwen-Omni 特定参数
                print("\n发送到API的消息结构(已省略Base64数据):", 
                      json.dumps([{"role": m.get("role"), 
                                  "content_type": "array" if isinstance(m.get("content"), list) else "text"} 
                                 for m in messages], ensure_ascii=False))
                
                # 如果没有消息，返回默认回复
                if not messages:
                    yield f"data: {json.dumps({'type': 'text', 'content': '请说些什么，我在听。'})}\n\n"
                    return
                
                # 调用API
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
                
                collected_response = {"role": "assistant", "content": "", "audio_parts": []}
                
                for chunk in response:
                    # 检查打断标志
                    if interrupt_flags.get(session_id, False):
                        print(f"检测到用户打断，结束AI回复流 (会话: {session_id})")
                        yield f"data: {json.dumps({'type': 'interrupted', 'content': '用户打断了回复'})}\n\n"
                        break
                    
                    # 检查特殊情况：完成通知或结束标记
                    if 'choices' not in chunk:
                        continue
                    
                    # 确保choices列表不为空再访问
                    if not chunk['choices'] or len(chunk['choices']) == 0:
                        continue
                        
                    # 安全地获取choice
                    choice = chunk['choices'][0]
                    
                    # 处理文本内容
                    if 'delta' in choice and 'content' in choice['delta'] and choice['delta']['content']:
                        text_content = choice['delta']['content']
                        collected_response["content"] += text_content
                        yield f"data: {json.dumps({'type': 'text', 'content': text_content})}\n\n"
                    
                    # 处理音频数据
                    if 'delta' in choice and 'audio' in choice['delta']:
                        try:
                            # 尝试获取音频数据
                            if 'data' in choice['delta']['audio']:
                                audio_data = choice['delta']['audio']['data']
                                collected_response["audio_parts"].append(audio_data)
                                yield f"data: {json.dumps({'type': 'audio', 'content': audio_data})}\n\n"
                            # 尝试获取转录文本
                            elif 'transcript' in choice['delta']['audio']:
                                transcript = choice['delta']['audio']['transcript']
                                yield f"data: {json.dumps({'type': 'transcript', 'content': transcript})}\n\n"
                        except Exception as e:
                            print(f"处理音频响应时出错: {e}")
                            continue
                            
                    # 检查是否是最后一个消息
                    if choice.get('finish_reason') is not None:
                        print("流式响应完成，原因:", choice.get('finish_reason'))
                        # 简化音频部分数据存储，避免消息过大
                        if collected_response.get("audio_parts", []):
                            collected_response["has_audio"] = True
                            collected_response.pop("audio_parts", None)
                        # 添加到对话历史
                        conversation_history.append(collected_response)
            
            except Exception as e:
                print(f"生成响应时发生错误: {e}")
                import traceback
                traceback.print_exc()
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            finally:
                # 无论如何标记AI已停止说话
                if session_id in active_calls:
                    active_calls[session_id]['is_speaking'] = False
                # 重置打断标志
                interrupt_flags[session_id] = False
                
        return Response(stream_with_context(generate()), content_type='text/event-stream')
        
    except Exception as e:
        print(f"流式响应发生错误: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# 定期清理过期会话
def cleanup_sessions():
    """清理超过超时时间的会话"""
    while True:
        current_time = time.time()
        expired_sessions = []
        
        for session_id, session_data in active_calls.items():
            if current_time - session_data['last_activity'] > SESSION_TIMEOUT * 60:
                expired_sessions.append(session_id)
        
        for session_id in expired_sessions:
            print(f"清理过期会话: {session_id}")
            active_calls.pop(session_id, None)
            interrupt_flags.pop(session_id, None)
        
        time.sleep(60)  # 每分钟检查一次

# 启动清理线程
cleanup_thread = threading.Thread(target=cleanup_sessions, daemon=True)
cleanup_thread.start()

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
        clean_audio_data = None
        if audio_data:
            try:
                # 从 base64 数据中提取编码部分
                if audio_data.startswith('data:audio/wav;base64,'):
                    # 提取原始base64数据
                    raw_base64 = audio_data[len('data:audio/wav;base64,'):]
                    # 按官方格式添加前缀 - 注意这里使用"data:;base64,"而非"data:audio/wav;base64,"
                    clean_audio_data = f"data:;base64,{raw_base64}"
                else:
                    # 如果没有前缀，直接添加官方前缀
                    clean_audio_data = f"data:;base64,{audio_data}"
                    
                # 提取并保存音频文件（便于调试）
                # 从带前缀的数据中提取原始base64
                if clean_audio_data.startswith('data:;base64,'):
                    raw_base64 = clean_audio_data[len('data:;base64,'):]
                else:
                    raw_base64 = clean_audio_data
                    
                audio_binary = base64.b64decode(raw_base64)
                filename = f"{uuid.uuid4()}.wav"
                file_path = os.path.join(UPLOAD_FOLDER, filename)
                
                with open(file_path, 'wb') as f:
                    f.write(audio_binary)
                
                print(f"\n已保存音频文件到: {file_path} (仅用于调试)")
                
            except Exception as e:
                print(f"\n处理音频数据时出错: {e}")
                clean_audio_data = None
        
        # 准备内容
        if text_input and clean_audio_data:
            # 文本+音频混合输入
            content_array = [
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": clean_audio_data,  # 按官方格式发送Base64数据
                        "format": "wav"
                    }
                },
                {"type": "text", "text": text_input}
            ]
            messages.append({"role": "user", "content": content_array})
            print(f"\n发送文本+音频消息: {text_input} + [音频数据]")
            
        elif text_input:
            # 只有文本
            messages.append({"role": "user", "content": text_input})
            print(f"\n发送纯文本消息: {text_input}")
            
        elif clean_audio_data:
            # 只有音频
            content_array = [
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": clean_audio_data,  # 按官方格式发送Base64数据
                        "format": "wav"
                    }
                }
            ]
            messages.append({"role": "user", "content": content_array})
            print(f"\n发送纯音频消息: [音频数据]")
            
        else:
            # 无效输入情况
            messages.append({"role": "user", "content": "请提供文字或语音输入"})
            print("\n没有有效输入内容")  
        
        def generate():
            try:
                # 使用 v0.28.0 API 结构与 Qwen-Omni 特定参数
                # 打印简版消息结构(不可直接打印完整Base64数据)
                print("\n发送到API的消息结构(已省略Base64数据):", 
                      json.dumps([{"role": m.get("role"), 
                                  "content_type": "array" if isinstance(m.get("content"), list) else "text"} 
                                 for m in messages], ensure_ascii=False))
                
                # 调用API
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
                    # 调试输出当前块的结构
                    # print(f"收到的块: {json.dumps(chunk)}")
                    
                    # 检查特殊情况：完成通知或结束标记
                    if 'choices' not in chunk:
                        continue
                    
                    # 确保choices列表不为空再访问
                    if not chunk['choices'] or len(chunk['choices']) == 0:
                        continue
                        
                    # 安全地获取choice
                    choice = chunk['choices'][0]
                    
                    # 处理文本内容
                    if 'delta' in choice and 'content' in choice['delta'] and choice['delta']['content']:
                        yield f"data: {json.dumps({'type': 'text', 'content': choice['delta']['content']})}\n\n"
                    
                    # 处理音频数据
                    if 'delta' in choice and 'audio' in choice['delta']:
                        try:
                            # 尝试获取音频数据
                            if 'data' in choice['delta']['audio']:
                                audio_data = choice['delta']['audio']['data']
                                yield f"data: {json.dumps({'type': 'audio', 'content': audio_data})}\n\n"
                            # 尝试获取转录文本
                            elif 'transcript' in choice['delta']['audio']:
                                transcript = choice['delta']['audio']['transcript']
                                yield f"data: {json.dumps({'type': 'transcript', 'content': transcript})}\n\n"
                        except Exception as e:
                            print(f"处理音频响应时出错: {e}")
                            continue
                            
                    # 检查是否是最后一个消息
                    if choice.get('finish_reason') is not None:
                        print("流式响应完成，原因:", choice.get('finish_reason'))
            
            except Exception as e:
                print(f"生成响应时发生错误: {e}")
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
