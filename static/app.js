/**
 * AI Human - 主应用入口文件
 * 集成所有模块并初始化应用
 */

// 导入组件模块 - 如果使用模块加载器，可以取消下面注释并使用import语法
/*
import TypewriterSystem from './js/typewriter.js';
import AudioRecorder from './js/audio-recorder.js';
import AudioStreamingSystem from './js/audio-streaming.js';
import MessageHandler from './js/message-handler.js';
*/

/**
 * AI Human - 主应用入口文件
 * 集成所有模块并初始化应用
 */

// 导入组件模块 - 如果使用模块加载器，可以取消下面注释并使用import语法
/*
import TypewriterSystem from './js/typewriter.js';
import AudioRecorder from './js/audio-recorder.js';
import AudioStreamingSystem from './js/audio-streaming.js';
import MessageHandler from './js/message-handler.js';
*/

document.addEventListener('DOMContentLoaded', () => {
    // DOM元素引用
    const elements = {
        chatMessages: document.getElementById('chat-messages'),
        textInput: document.getElementById('text-input'),
        voiceButton: document.getElementById('voice-button'),
        sendButton: document.getElementById('send-button'),
        recordingIndicator: document.getElementById('recording-indicator'),
        statusMessage: document.getElementById('status-message')
    };
    
    // 音频上下文
    let audioContext;
    
    // 动态加载模块 - 如果使用模块加载器，可以直接使用import的变量
    let TypewriterSystem, AudioRecorder, AudioStreamingSystem, MessageHandler;

    // 加载所有组件模块
    const loadModules = async () => {
        try {
            // 动态引入模块 - 如果浏览器不支持ES模块，可以使用脚本标签引入 
            TypewriterSystem = await import('./js/typewriter.js').then(m => m.default);
            AudioRecorder = await import('./js/audio-recorder.js').then(m => m.default);
            AudioStreamingSystem = await import('./js/audio-streaming.js').then(m => m.default);
            MessageHandler = await import('./js/message-handler.js').then(m => m.default);

            console.log('模块成功加载');
            initializeApp(); 
        } catch (error) {
            console.error('加载模块失败:', error);
            // 作为回退方案，可以在这里加载替代脚本
            alert('加载模块失败，请查看控制台以获取详细信息。如果您的浏览器不支持ES模块，请考虑使用其他浏览器。');
        }
    };

    // 主应用初始化函数
    const initializeApp = () => {
        // 创建各模块实例
        const typewriter = TypewriterSystem;
        const audioStreamingSystem = new AudioStreamingSystem(elements.statusMessage);
        const audioRecorder = new AudioRecorder(elements.statusMessage);
        const messageHandler = new MessageHandler(
            {
                chatMessages: elements.chatMessages,
                statusElement: elements.statusMessage
            },
            typewriter,
            audioStreamingSystem
        );
    
        // 初始化音频上下文
        const initAudioContext = async () => {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                audioStreamingSystem.init(audioContext);
                elements.statusMessage.textContent = "音频系统已初始化";
                return audioContext;
            } catch (error) {
                console.error("初始化音频上下文出错:", error);
                elements.statusMessage.textContent = "音频系统初始化失败";
                return null;
            }
        };
    
        // 事件监听器
        elements.voiceButton.addEventListener('click', async () => {
            // 确保音频上下文已初始化
            if (!audioContext) {
                audioContext = await initAudioContext();
                if (!audioContext) return;
            }
            
            if (audioRecorder.getIsRecording()) {
                // 如果正在录音，停止并发送
                const audioData = await audioRecorder.stopRecording();
                if (audioData) {
                    // 更新UI
                    elements.voiceButton.classList.remove('recording');
                    elements.recordingIndicator.classList.remove('active');
                    // 发送音频消息
                    messageHandler.sendMessage('', audioData);
                }
            } else {
                // 开始录音
                const success = await audioRecorder.startRecording(audioContext);
                if (success) {
                    // 更新UI
                    elements.voiceButton.classList.add('recording');
                    elements.recordingIndicator.classList.add('active');
                }
            }
        });
    
        // 文本发送按钮事件
        elements.sendButton.addEventListener('click', () => {
            const text = elements.textInput.value.trim();
            if (text) {
                messageHandler.sendMessage(text);
                elements.textInput.value = '';
            }
        });
        
        // 输入框回车键事件
        elements.textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const text = elements.textInput.value.trim();
                if (text) {
                    messageHandler.sendMessage(text);
                    elements.textInput.value = '';
                }
            }
        });
        
        // 初始化时自动初始化音频上下文
        document.body.addEventListener('click', async () => {
            if (!audioContext) {
                audioContext = await initAudioContext();
            }
        }, { once: true });
    };
    
    // 尝试加载模块
    loadModules();
}); 

/**
 * 如果您的浏览器不支持ES模块，您可以使用下面的脚本标签方式引入所需模块
 * 将下面代码添加到您的HTML文件中：
 *
 * <script src="./js/typewriter.js"></script>
 * <script src="./js/audio-recorder.js"></script>
 * <script src="./js/audio-streaming.js"></script>
 * <script src="./js/message-handler.js"></script>
 * <script src="./app.js"></script>
 */
            
            // Handle SSE stream response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            let aiResponseText = '';
            let audioBase64Chunks = [];
            let audioStreamPlaying = false;

            // Create message placeholder for AI response
            const messageElement = document.createElement('div');
            messageElement.className = 'message ai-message';
            messageElement.innerHTML = '<div class="typing-indicator">AI 正在回复...</div>';
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            // 用于打字机效果的异步函数
            // 全局唯一typewriter动画与状态
            let typewriterTarget = null;
            let typewriterInterval = null;
            let typewriterIndex = 0;
            let aiTypingBuffer = ''; // 所有文本片段累积缓冲
            let isQuotedMessage = false; // 标记是否已添加了引号

            // 重置所有状态
            function resetTypewriter() {
                if (typewriterInterval) {
                    clearInterval(typewriterInterval);
                    typewriterInterval = null;
                }
                typewriterTarget = null;
                typewriterIndex = 0;
                aiTypingBuffer = '';
                isQuotedMessage = false;
            }

            // 添加新文本的统一入口
            function addToTypingBuffer(content, isTranscript = false) {
                if (isTranscript && !isQuotedMessage) {
                    // 如果是transcript类型且还没有引号，添加前引号
                    isQuotedMessage = true;
                    aiTypingBuffer = `"${content}`;
                } else {
                    // 其他情况直接追加
                    aiTypingBuffer += content;
                }
                console.log('[DEBUG] 累计文本:', aiTypingBuffer);
                return aiTypingBuffer;
            }

            // 控制打字机效果
            function startTypewriter(target, speed = 15) {
                typewriterTarget = target;
                
                // 如果打字机正在运行，则不需要重新启动
                if (typewriterInterval) return; 
                
                typewriterInterval = setInterval(() => {
                    // 确保情况变化时能正确更新DOM
                    if (typewriterIndex < aiTypingBuffer.length) {
                        if (typewriterIndex === 0) {
                            typewriterTarget.innerHTML = aiTypingBuffer.charAt(0);
                        } else {
                            typewriterTarget.innerHTML += aiTypingBuffer.charAt(typewriterIndex);
                        }
                        typewriterIndex++;
                        // 每次打字后自动滚动到最新位置
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    } else {
                        // 已补全到当前目标缓冲区，暂停等待新片段
                        clearInterval(typewriterInterval);
                        typewriterInterval = null;
                    }
                }, speed);
            }

            // 在初始化时重置打字机状态
            resetTypewriter();
            
            // 使用更健壮的方式处理SSE数据
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        try {
                            const jsonStr = line.substring(5).trim();
                            const data = JSON.parse(jsonStr);
                            if (data.type === 'text' && data.content) {
                                // 统一流程处理文本
                                addToTypingBuffer(data.content, false);
                                startTypewriter(messageElement);
                            } else if (data.type === 'audio' && data.content) {
                                audioBase64Chunks.push(data.content);
                                // 将新的音频片段添加到队列
                                audioSystem.addAudioChunk(data.content);
                            } else if (data.type === 'transcript' && data.content) {
                                console.log("Transcript:", data.content);
                                // 统一流程处理转录文本
                                addToTypingBuffer(data.content, true);
                                startTypewriter(messageElement);
                            } else if (data.type === 'error') {
                                console.error("服务器错误:", data.content);
                                messageElement.innerHTML = `<span class="error">服务器错误: ${data.content}</span>`;
                            }
                        } catch (e) {
                            console.error("解析SSE数据错误:", e);
                        }
                    }
                }
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

            // SSE流结束后，平滑处理最终文本
            if (aiTypingBuffer) {
                // 如果是引用式消息，添加右引号
                if (isQuotedMessage && !aiTypingBuffer.endsWith('"')) {
                    console.log('[调试] 添加结束引号');  
                    aiTypingBuffer += '"';
                }
                
                // 不立即结束动画，继续打字机效果
                startTypewriter(messageElement);
                console.log('[调试] 最终AI回复内容：', aiTypingBuffer);
                
                // 等待打字机效果自然完成后再更新状态
                const checkComplete = setInterval(() => {
                    if (!typewriterInterval) {
                        clearInterval(checkComplete);
                        statusMessage.textContent = "回复完成";
                    }
                }, 100);
            } else {
                statusMessage.textContent = "回复完成";
            }
        } catch (error) {
            console.error("Error sending message:", error);
            statusMessage.textContent = "发送消息失败";
            appendMessage("⚠️ 发送消息出错，请稍后重试", "system");
        }
    };
    
    // Append message to chat
    const appendMessage = (text, sender) => {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}-message`;
        messageElement.textContent = text;
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    
    // 音频系统方法扩展
    Object.assign(audioSystem, {
        // 添加新的音频片段到队列
        addAudioChunk(base64Data) {
            // 移除可能的前缀
            if (base64Data.startsWith('data:audio/wav;base64,')) {
                base64Data = base64Data.substring('data:audio/wav;base64,'.length);
            }
            
            // 将新片段放入队列
            this.audioQueue.push(base64Data);
            this.hasNewChunks = true;
            
            // 如果不在处理中，开始处理
            if (!this.isProcessing) {
                this.processAudioQueue();
            }
        },
        
        // 处理音频队列
        async processAudioQueue() {
            if (!this.audioContext) {
                console.error("音频上下文未初始化");
                return;
            }
            
            this.isProcessing = true;
            statusMessage.textContent = "处理音频中...";
            
            try {
                while (this.audioQueue.length > 0 || this.hasNewChunks) {
                    this.hasNewChunks = false;
                    
                    if (this.audioQueue.length === 0) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        continue;
                    }
                    
                    // 从队列中取出一个片段
                    const base64Chunk = this.audioQueue.shift();
                    
                    // 处理音频片段
                    await this.processAudioChunk(base64Chunk);
                }
                
                statusMessage.textContent = "音频处理完成";
            } catch (error) {
                console.error("处理音频队列时出错:", error);
                statusMessage.textContent = "音频处理失败";
            }
            
            this.isProcessing = false;
        },
        
        // 处理单个音频片段 
        async processAudioChunk(base64Data) {
            try {
                // Base64解码
                const binaryString = atob(base64Data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                
                // 检查是否是第一个片段（含WAV头）
                const isFirstChunk = this.accumulatedSamples === null;
                
                // 提取PCM样本
                let samples;
                if (isFirstChunk) {
                    // 第一个片段，跳过44字节的WAV头
                    const wavHeader = bytes.slice(0, 44);
                    const pcmData = bytes.slice(44);
                    
                    // 转换为Int16Array (16bit音频)
                    samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
                    
                    // 保存WAV头信息以便后续使用
                    this.wavHeader = wavHeader;
                    
                    // 开始播放
                    this.beginPlayback();
                } else {
                    // 后续片段直接是PCM数据
                    samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
                }
                
                // 累积样本或添加到播放队列
                this.addSamplesToPlayback(samples);
                
            } catch (error) {
                console.error("处理音频片段时出错:", error);
            }
        },
        
        // 开始音频播放
        beginPlayback() {
            if (this.isPlaying) return;
            
            // 创建音频节点
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 1.0;
            gainNode.connect(this.audioContext.destination);
            
            this.audioNodes.gainNode = gainNode;
            this.isPlaying = true;
            this.playNextBuffer();
        },
        
        // 将样本添加到播放队列
        addSamplesToPlayback(newSamples) {
            // 将Int16Array转换为Float32Array (Web Audio API需要)
            const floatSamples = new Float32Array(newSamples.length);
            for (let i = 0; i < newSamples.length; i++) {
                // 将16位整数转换为-1.0到1.0之间的浮点数
                floatSamples[i] = newSamples[i] / 32768.0;
            }
            
            // 如果之前有累积的样本，与新样本合并
            if (this.accumulatedSamples) {
                const combined = new Float32Array(this.accumulatedSamples.length + floatSamples.length);
                combined.set(this.accumulatedSamples, 0);
                combined.set(floatSamples, this.accumulatedSamples.length);
                this.accumulatedSamples = combined;
            } else {
                this.accumulatedSamples = floatSamples;
            }
            
            // 尝试播放下一个缓冲区
            if (this.isPlaying) {
                this.playNextBuffer();
            }
        },
        
        // 播放下一个音频缓冲区
        playNextBuffer() {
            // 如果没有足够的样本或已经在播放中，则返回
            if (!this.accumulatedSamples || this.accumulatedSamples.length === 0) {
                return;
            }
            
            // 创建音频缓冲区
            // 每次播放0.5秒的音频
            const bufferSize = Math.min(this.sampleRate / 2, this.accumulatedSamples.length);
            
            // 创建音频缓冲区
            const audioBuffer = this.audioContext.createBuffer(1, bufferSize, this.sampleRate);
            const channelData = audioBuffer.getChannelData(0);
            channelData.set(this.accumulatedSamples.slice(0, bufferSize));
            
            // 更新累积的样本
            this.accumulatedSamples = this.accumulatedSamples.slice(bufferSize);
            
            // 创建音频源节点
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.audioNodes.gainNode);
            
            // 计算开始播放的时间
            const startTime = Math.max(this.audioContext.currentTime, this.playbackPosition);
            source.start(startTime);
            
            // 更新播放位置
            this.playbackPosition = startTime + audioBuffer.duration;
            
            // 在缓冲区播放结束时调度下一个缓冲区
            source.onended = () => {
                // 如果还有更多样本，继续播放
                if (this.accumulatedSamples && this.accumulatedSamples.length > 0) {
                    this.playNextBuffer();
                }
            };
            
            // 或者在即将结束前安排下一个缓冲区的播放
            const timeBeforeEnd = audioBuffer.duration * 0.8; // 在结束前80%的时间点
            setTimeout(() => {
                if (this.accumulatedSamples && this.accumulatedSamples.length > 0) {
                    this.playNextBuffer();
                }
            }, timeBeforeEnd * 1000);
        }
    });
    
    // 传统的非流式播放方式（备用）
    const playAudioResponse = async (base64Chunks) => {
        try {
            if (!audioContext) {
                await initAudioContext();
            }
            
            if (base64Chunks.length === 0) {
                statusMessage.textContent = '未收到音频数据';
                return;
            }
            
            // 合并所有音频片段 
            let fullBase64 = base64Chunks.join('');
            if (fullBase64.startsWith('data:audio/wav;base64,')) {
                fullBase64 = fullBase64.substring('data:audio/wav;base64,'.length);
            }
            
            // 生成Blob并播放
            const byteCharacters = atob(fullBase64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(blob);
            
            if (currentAudioPlayer) {
                currentAudioPlayer.pause();
                currentAudioPlayer = null;
            }
            
            const audio = new Audio(audioUrl);
            currentAudioPlayer = audio;
            
            audio.onerror = (e) => {
                console.error('音频播放错误:', e);
                statusMessage.textContent = '播放音频失败';
                URL.revokeObjectURL(audioUrl);
            };
            
            audio.onended = () => {
                currentAudioPlayer = null;
                statusMessage.textContent = '就绪';
                URL.revokeObjectURL(audioUrl);
            };
            
            audio.oncanplaythrough = () => {
                statusMessage.textContent = '正在播放回复...';
                audio.play().catch(err => {
                    console.error('播放音频失败:', err);
                    statusMessage.textContent = '播放音频失败';
                });
            };
        } catch (error) {
            console.error('处理音频时出错:', error);
            statusMessage.textContent = '播放音频失败';
        }
    };

    
    // Event Listeners
    voiceButton.addEventListener('click', async () => {
        if (isRecording) {
            const audioData = await stopRecording();
            sendMessage('', audioData);
        } else {
            startRecording();
        }
    });
    
    sendButton.addEventListener('click', () => {
        const text = textInput.value.trim();
        if (text) {
            sendMessage(text);
            textInput.value = '';
        }
    });
    
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const text = textInput.value.trim();
            if (text) {
                sendMessage(text);
                textInput.value = '';
            }
        }
    });
    
    // Initialize
    document.body.addEventListener('click', async () => {
        if (!audioContext) {
            await initAudioContext();
        }
    }, { once: true });
});
