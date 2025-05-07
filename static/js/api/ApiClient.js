/**
 * API客户端模块 - 处理与服务器的通信
 */
class ApiClient {
    constructor() {
        this.responseAbortController = null;
    }
    
    /**
     * 创建新的通话会话
     * @returns {Promise<string>} 会话ID
     */
    async createSession() {
        const response = await fetch('/api/call/start', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
        });
        
        if (!response.ok) {
            throw new Error(`服务器错误: ${response.status}`);
        }
        
        const data = await response.json();
        return data.session_id;
    }
    
    /**
     * 结束通话会话
     * @param {string} sessionId - 会话ID
     */
    async endSession(sessionId) {
        if (!sessionId) return;
        
        try {
            await fetch('/api/call/end', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({session_id: sessionId})
            });
        } catch (error) {
            console.error("通知服务器结束通话失败", error);
        }
    }
    
    /**
     * 发送音频数据到服务器
     * @param {string} sessionId - 会话ID
     * @param {string} audioData - Base64编码的音频数据
     * @param {number} audioLevel - 音频电平
     */
    async sendAudio(sessionId, audioData, audioLevel) {
        if (!sessionId) return;
        
        const requestData = {
            audio: audioData,
            session_id: sessionId,
            audio_level: audioLevel
        };
        
        const response = await fetch('/api/voice-chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            throw new Error(`服务器错误: ${response.status}`);
        }
        
        return response.json();
    }
    
    /**
     * 接收AI响应流
     * @param {string} sessionId - 会话ID
     * @param {Function} onTextChunk - 文本块回调
     * @param {Function} onAudioChunk - 音频块回调
     * @param {Function} onTranscript - 转写回调
     * @param {Function} onInterrupted - 被打断回调
     * @param {Function} onError - 错误回调
     * @param {Function} onComplete - 完成回调
     */
    async receiveAIResponse(sessionId, onTextChunk, onAudioChunk, onTranscript, onInterrupted, onError, onComplete) {
        if (!sessionId) return;
        
        try {
            // 创建中断控制器
            this.responseAbortController = new AbortController();
            const { signal } = this.responseAbortController;
            
            // 发送流式请求
            const response = await fetch('/api/voice-chat/stream', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ session_id: sessionId }),
                signal: signal
            });
            
            if (!response.ok) {
                throw new Error(`接收响应错误: ${response.status}`);
            }
            
            // 获取响应流读取器
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            let collectedText = '';
            let hasAudio = false;
            
            // 读取并处理响应流
            while (true) {
                const { done, value } = await reader.read();
                
                // 如果流结束，退出循环
                if (done) break;
                
                // 解码并处理数据块
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.substring(6));
                            
                            switch (data.type) {
                                case 'text':
                                    collectedText += data.content;
                                    if (onTextChunk) onTextChunk(data.content, collectedText);
                                    break;
                                    
                                case 'audio':
                                    hasAudio = true;
                                    if (onAudioChunk) onAudioChunk(data.content);
                                    break;
                                    
                                case 'transcript':
                                    if (onTranscript) onTranscript(data.content);
                                    break;
                                    
                                case 'interrupted':
                                    if (onInterrupted) onInterrupted();
                                    return; // 提前退出
                                    
                                case 'error':
                                    if (onError) onError(data.content);
                                    return; // 提前退出
                            }
                        } catch (error) {
                            console.error('解析响应数据失败:', error, line);
                        }
                    }
                }
            }
            
            // 响应完成
            if (onComplete) onComplete(collectedText, hasAudio);
            
        } catch (error) {
            // 忽略中断错误
            if (error.name === 'AbortError') {
                console.log('响应已被用户中断');
                return;
            }
            
            if (onError) onError(error.message);
            console.error('接收AI回复出错:', error);
        } finally {
            this.responseAbortController = null;
        }
    }
    
    /**
     * 中断当前AI响应
     * @param {string} sessionId - 会话ID
     */
    interruptAIResponse(sessionId) {
        if (!sessionId) return;
        
        // 1. 中断当前的响应流
        if (this.responseAbortController) {
            this.responseAbortController.abort();
            this.responseAbortController = null;
        }
        
        // 2. 通知服务器打断
        fetch('/api/call/interrupt', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ session_id: sessionId })
        }).catch(error => {
            console.error('发送打断信号失败:', error);
        });
    }
    
    /**
     * 中断当前响应（不发送到服务器）
     */
    abortCurrentResponse() {
        if (this.responseAbortController) {
            this.responseAbortController.abort();
            this.responseAbortController = null;
        }
    }
}

export default ApiClient;
