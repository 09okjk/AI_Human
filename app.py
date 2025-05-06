import os
from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory
from flask_cors import CORS
from openai import OpenAI
import base64
import json
import numpy as np
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__, static_folder='static')
CORS(app)

# Initialize OpenAI client
client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY") or "sk-xxx",  # Replace with your API key if not using env var
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

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
        
        # Prepare messages for API call
        messages = [{"role": "user", "content": []}]
        
        # Add audio if provided
        if audio_data:
            messages[0]["content"].append({
                "type": "input_audio",
                "input_audio": {
                    "data": audio_data,
                    "format": "wav",
                },
            })
        
        # Add text if provided
        if text_input:
            messages[0]["content"].append({"type": "text", "text": text_input})
        
        def generate():
            completion = client.chat.completions.create(
                model="qwen-omni-turbo-0119",
                messages=messages,
                modalities=["text", "audio"],
                audio={"voice": "Cherry", "format": "wav"},
                stream=True,
                stream_options={"include_usage": True},
            )
            
            for chunk in completion:
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    if hasattr(delta, "content") and delta.content:
                        yield f"data: {json.dumps({'type': 'text', 'content': delta.content})}\n\n"
                    elif hasattr(delta, "audio"):
                        try:
                            audio_string = delta.audio["data"]
                            yield f"data: {json.dumps({'type': 'audio', 'content': audio_string})}\n\n"
                        except Exception as e:
                            transcript = delta.audio.get("transcript", "")
                            if transcript:
                                yield f"data: {json.dumps({'type': 'transcript', 'content': transcript})}\n\n"
                else:
                    # Send usage info if available
                    if hasattr(chunk, "usage"):
                        yield f"data: {json.dumps({'type': 'usage', 'content': str(chunk.usage)})}\n\n"
            
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
            completion = client.chat.completions.create(
                model="qwen-omni-turbo-0119",
                messages=[{"role": "user", "content": text_input}],
                modalities=["text", "audio"],
                audio={"voice": "Cherry", "format": "wav"},
                stream=True,
                stream_options={"include_usage": True},
            )
            
            for chunk in completion:
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    if hasattr(delta, "content") and delta.content:
                        yield f"data: {json.dumps({'type': 'text', 'content': delta.content})}\n\n"
                    elif hasattr(delta, "audio"):
                        try:
                            audio_string = delta.audio["data"]
                            yield f"data: {json.dumps({'type': 'audio', 'content': audio_string})}\n\n"
                        except Exception as e:
                            transcript = delta.audio.get("transcript", "")
                            if transcript:
                                yield f"data: {json.dumps({'type': 'transcript', 'content': transcript})}\n\n"
                else:
                    if hasattr(chunk, "usage"):
                        yield f"data: {json.dumps({'type': 'usage', 'content': str(chunk.usage)})}\n\n"
            
        return Response(stream_with_context(generate()), content_type='text/event-stream')
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # For LAN access, use '0.0.0.0' instead of 'localhost'
    app.run(host='0.0.0.0', port=5000, debug=True)
