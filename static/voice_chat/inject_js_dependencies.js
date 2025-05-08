// 用于voice_chat与js目录的依赖注入桥接
import MessageHandler from '../js/message-handler.js';
import typewriter from '../js/typewriter.js';
import AudioStreamingSystem from '../js/audio-streaming.js';

// 提供全局唯一的聊天窗口和状态栏
const chatMessages = document.getElementById('chat-messages');
const statusElement = document.getElementById('status-message');

// 音频流系统实例
const audioSystem = new AudioStreamingSystem(statusElement);

// 消息处理器实例
const messageHandler = new MessageHandler({ chatMessages, statusElement }, typewriter, audioSystem);

// 导出全局对象，供voice_chat和问答共用
window.voiceChatMessageHandler = messageHandler;
window.voiceChatTypewriter = typewriter;
window.voiceChatAudioSystem = audioSystem;
