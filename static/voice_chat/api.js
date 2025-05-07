/**
 * 语音通话API通信模块
 * 处理与服务器的通信功能
 */

// 创建服务器会话
async function createServerSession() {
    const response = await fetch('/api/call/start', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'}
    });
    
    if (!response.ok) {
        throw new Error(`服务器错误: ${response.status}`);
    }
    
    return await response.json();
}

// 结束服务器会话
async function endServerSession() {
    try {
        await fetch('/api/call/end', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({session_id: this.sessionId})
        });
    } catch (error) {
        console.error("通知服务器结束通话失败", error);
    }
}

// 将音频数据发送到服务器
async function sendAudioToServer(audioData) {
    if (!this.sessionId || !this.isCallActive) return;
    
    try {
        this.updateStatus('发送数据到服务器...');
        
        // 准备请求数据
        const requestData = {
            audio: audioData,
            session_id: this.sessionId,
            audio_level: this.lastAudioLevel
        };
        
        // 发送POST请求
        const response = await fetch('/api/voice-chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            throw new Error(`服务器错误: ${response.status}`);
        }
        
        // 添加用户消息到聊天界面
        this.addMessage('您', '[语音输入]', 'user');
        
        // 接收AI响应
        await this.receiveAIResponse();
        
    } catch (error) {
        console.error('发送音频失败:', error);
        this.updateStatus('发送失败: ' + error.message);
        
        if (error.message.includes('Failed to fetch')) {
            this.addMessage('系统', '连接服务器失败，请检查网络连接', 'system');
        }
    }
}

// 接收并处理AI的流式响应
async function receiveAIResponse() {
    if (!this.sessionId || !this.isCallActive) return;
    
    try {
        this.updateStatus('等待AI回复...');
        
        // 创建中断控制器，用于在需要时中断响应
        this.responseAbortController = new AbortController();
        const { signal } = this.responseAbortController;
        
        // 发送流式请求
        const response = await fetch('/api/voice-chat/stream', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ session_id: this.sessionId }),
            signal: signal
        });
        
        if (!response.ok) {
            throw new Error(`接收响应错误: ${response.status}`);
        }
        
        // 设置响应处理状态
        let aiMessage = '';
        let hasAudio = false;
        this.isAiSpeaking = true;
        
        // 获取响应流读取器
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
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
                                // 处理文本响应
                                aiMessage += data.content;
                                this.updateAIMessage(aiMessage);
                                this.updateStatus('AI正在回复...');
                                break;
                                
                            case 'audio':
                                // 处理音频响应
                                this.playAudioChunk(data.content);
                                hasAudio = true;
                                this.updateStatus('AI正在语音回复...');
                                break;
                                
                            case 'transcript':
                                console.log('语音转写:', data.content);
                                break;
                                
                            case 'interrupted':
                                console.log('AI回复被打断');
                                this.updateStatus('已打断AI回复');
                                this.isAiSpeaking = false;
                                return; // 提前退出
                                
                            case 'error':
                                console.error('服务器错误:', data.content);
                                this.addMessage('系统', `错误: ${data.content}`, 'system');
                                this.updateStatus('发生错误: ' + data.content);
                                this.isAiSpeaking = false;
                                return; // 提前退出
                        }
                    } catch (error) {
                        console.error('解析响应数据失败:', error, line);
                    }
                }
            }
        }
        
        // 响应完成，保存完整消息
        if (aiMessage) {
            this.completeAIMessage(aiMessage, hasAudio);
        }
        
        // 更新状态
        this.isAiSpeaking = false;
        this.updateStatus('等待您说话');
        
    } catch (error) {
        // 忽略中断错误
        if (error.name === 'AbortError') {
            console.log('响应已被用户中断');
            return;
        }
        
        console.error('接收AI回复出错:', error);
        this.isAiSpeaking = false;
        this.updateStatus('接收回复失败: ' + error.message);
    } finally {
        // 清理中断控制器
        this.responseAbortController = null;
    }
}

// 中断当前AI响应
function interruptAIResponse() {
    if (!this.isAiSpeaking || !this.sessionId) return;
    
    console.log('正在打断AI回复...');
    
    // 1. 中断当前的响应流
    if (this.responseAbortController) {
        this.responseAbortController.abort();
        this.responseAbortController = null;
    }
    
    // 2. 通知服务器打断
    fetch('/api/call/interrupt', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ session_id: this.sessionId })
    }).catch(error => {
        console.error('发送打断信号失败:', error);
    });
    
    // 3. 更新状态
    this.isAiSpeaking = false;
    this.updateStatus('用户打断了AI');
}

// 导出API相关函数
export default {
    createServerSession,
    endServerSession,
    sendAudioToServer,
    receiveAIResponse,
    interruptAIResponse
};
