document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const chatMessages = document.getElementById('chat-messages');
    const textInput = document.getElementById('text-input');
    const voiceButton = document.getElementById('voice-button');
    const sendButton = document.getElementById('send-button');
    const recordingIndicator = document.getElementById('recording-indicator');
    const statusMessage = document.getElementById('status-message');
    
    // 音频上下文和流式音频系统
    let audioContext;
    let microphone;
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    let currentAudioPlayer = null;
    
    // 音频流式播放系统
    const audioSystem = {
        // 音频片段队列
        audioQueue: [],
        // 是否正在处理音频
        isProcessing: false,
        // 是否正在播放
        isPlaying: false,
        // 是否有新片段等待处理
        hasNewChunks: false,
        // 当前播放位置
        playbackPosition: 0,
        // 累积的音频数据
        accumulatedSamples: null,
        // Web Audio API 节点
        audioNodes: {},
        // 采样率(QWen-Omni固定输出为24000Hz)
        sampleRate: 24000,
        // 重置系统
        reset() {
            this.audioQueue = [];
            this.isProcessing = false;
            this.isPlaying = false;
            this.hasNewChunks = false;
            this.playbackPosition = 0;
            this.accumulatedSamples = null;
        },
        // 初始化音频系统
        init(context) {
            this.audioContext = context;
            this.audioNodes = {};
            this.reset();
        },
    };
    
    // 初始化音频上下文（浏览器要求用户交互后初始化）
    const initAudioContext = async () => {
        try {
            // 创建音频上下文
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            // 初始化流式音频系统
            audioSystem.init(audioContext);
            statusMessage.textContent = "音频系统已初始化";
        } catch (error) {
            console.error("Error initializing audio context:", error);
            statusMessage.textContent = "音频系统初始化失败";
        }
    };
    
    // Start recording function
    const startRecording = async () => {
        try {
            if (!audioContext) {
                await initAudioContext();
            }
            
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            microphone = stream;
            
            // Setup media recorder
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            // Listen for data available event
            mediaRecorder.addEventListener('dataavailable', event => {
                audioChunks.push(event.data);
            });
            
            // Start recording
            mediaRecorder.start();
            isRecording = true;
            
            // Update UI
            voiceButton.classList.add('recording');
            recordingIndicator.classList.add('active');
            statusMessage.textContent = "正在录音...";
        } catch (error) {
            console.error("Error starting recording:", error);
            statusMessage.textContent = "无法访问麦克风";
        }
    };
    
    // Stop recording function
    const stopRecording = () => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            return;
        }
        
        return new Promise(resolve => {
            mediaRecorder.addEventListener('stop', async () => {
                // Create audio blob from chunks
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                
                // Convert to base64
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64Audio = reader.result;
                    resolve(base64Audio);
                };
                
                // Release microphone
                if (microphone) {
                    microphone.getTracks().forEach(track => track.stop());
                }
            });
            
            // Stop recording
            mediaRecorder.stop();
            isRecording = false;
            
            // Update UI
            voiceButton.classList.remove('recording');
            recordingIndicator.classList.remove('active');
            statusMessage.textContent = "录音已完成";
        });
    };
    
    // Send message to backend
    const sendMessage = async (text = '', audioData = null) => {
        if (!text && !audioData) return;
        
        // Display user message
        if (text) {
            appendMessage(text, 'user');
        } else {
            appendMessage('🎤 [语音消息]', 'user');
        }
        
        try {
            statusMessage.textContent = "正在处理...";
            
            // Prepare request data
            const requestData = {};
            if (text) requestData.text = text;
            if (audioData) requestData.audio = audioData;
            
            // Send to backend
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData),
            });
            
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}`);
            }
            
            // Handle SSE stream response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            let aiResponseText = '';
            let aiTypingBuffer = '';
            let audioBase64Chunks = [];
            let audioStreamPlaying = false;

            // Create message placeholder for AI response
            const messageElement = document.createElement('div');
            messageElement.className = 'message ai-message';
            messageElement.innerHTML = '<div class="typing-indicator">AI 正在回复...</div>';
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            // 用于打字机效果的异步函数
            // 全局唯一typewriter动画
            let typewriterTarget = null;
            let typewriterInterval = null;
            let typewriterIndex = 0;

            function startTypewriter(target, speed = 20) {
                typewriterTarget = target;
                if (typewriterInterval) return; // 已有动画在跑，直接等它补全
                typewriterIndex = target.innerHTML.length;
                typewriterInterval = setInterval(() => {
                    if (typewriterIndex < aiTypingBuffer.length) {
                        typewriterTarget.innerHTML += aiTypingBuffer.charAt(typewriterIndex);
                        typewriterIndex++;
                    } else {
                        // 已补全到当前目标，等待新片段
                        clearInterval(typewriterInterval);
                        typewriterInterval = null;
                    }
                }, speed);
            }

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
                                // 实现逐字打字机效果
                                aiTypingBuffer += data.content;
                                startTypewriter(messageElement);
                            } else if (data.type === 'audio' && data.content) {
                                audioBase64Chunks.push(data.content);
                                // 将新的音频片段添加到队列
                                audioSystem.addAudioChunk(data.content);
                            } else if (data.type === 'transcript' && data.content) {
                                console.log("Transcript:", data.content);
                                if (!aiTypingBuffer) {
                                    aiTypingBuffer = `"${data.content}" `;
                                    startTypewriter(messageElement);
                                }
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

            // 不再自动调用playAudioResponse，彻底只用流式Web Audio API
            // if (audioBase64Chunks.length > 0) {
            //     playAudioResponse(audioBase64Chunks);
            // }

            // SSE流结束后，强制刷新最终文本，防止卡在“AI正在回复...”
            if (aiTypingBuffer) {
                // 结束动画，强制刷新最终文本
                if (typewriterInterval) {
                    clearInterval(typewriterInterval);
                    typewriterInterval = null;
                }
                messageElement.innerHTML = aiTypingBuffer;
                console.log('[调试] 最终AI回复内容：', aiTypingBuffer);
            }
            statusMessage.textContent = "回复完成";
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
