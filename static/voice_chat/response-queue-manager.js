/**
 * 响应队列管理器
 * 管理多个对话的响应队列，解决打断AI回复时旧内容继续显示的问题
 */
class ResponseQueueManager {
    /**
     * 构造函数
     * @param {number} maxQueues - 最大队列数量
     */
    constructor(maxQueues = 5) {
        this.queues = [];        // 队列数组
        this.maxQueues = maxQueues;  // 最大队列数量
        this.activeQueueId = null;   // 当前活动队列ID
    }
    
    /**
     * 创建新队列
     * @param {string} dialogId - 对话ID
     * @returns {Object} - 创建的队列对象
     */
    createQueue(dialogId) {
        console.log(`创建新队列: ${dialogId}`);
        
        // 如果已达到最大队列数，移除最早的
        if (this.queues.length >= this.maxQueues) {
            const removed = this.queues.shift();
            console.log(`队列数量达到上限，移除最早的队列: ${removed.id}`);
        }
        
        // 创建新队列
        const newQueue = {
            id: dialogId,
            createdAt: Date.now(),
            responses: [],
            isActive: true,
            textContent: '', // 累积的文本内容
            audioChunks: [] // 累积的音频片段
        };
        
        // 将之前的队列标记为非活动
        this.queues.forEach(q => q.isActive = false);
        
        // 添加新队列
        this.queues.push(newQueue);
        this.activeQueueId = dialogId;
        
        return newQueue;
    }
    
    /**
     * 添加响应到对应队列
     * @param {string} dialogId - 对话ID
     * @param {Object} response - 响应对象
     * @returns {Array} - 队列中的所有响应
     */
    addResponse(dialogId, response) {
        // 找到对应队列
        let queue = this.queues.find(q => q.id === dialogId);
        
        // 如果队列不存在或不再活动，创建新队列
        if (!queue || !queue.isActive) {
            if (!queue) {
                queue = this.createQueue(dialogId);
            } else if (!queue.isActive) {
                console.log(`队列 ${dialogId} 已非活动，忽略响应`);
                return [];
            }
        }
        
        // 根据响应类型处理
        if (response.type === 'text' && response.content) {
            queue.textContent += response.content;
        } else if (response.type === 'audio' && response.content) {
            queue.audioChunks.push(response.content);
        }
        
        // 添加响应
        queue.responses.push(response);
        
        return queue.responses;
    }
    
    /**
     * 获取活动队列
     * @returns {Object|null} - 活动队列或null
     */
    getActiveQueue() {
        return this.queues.find(q => q.isActive) || null;
    }
    
    /**
     * 获取活动队列的所有响应
     * @returns {Array} - 活动队列的响应
     */
    getActiveResponses() {
        const activeQueue = this.getActiveQueue();
        return activeQueue ? activeQueue.responses : [];
    }
    
    /**
     * 获取活动队列的累积文本内容
     * @returns {string} - 累积的文本内容
     */
    getActiveTextContent() {
        const activeQueue = this.getActiveQueue();
        return activeQueue ? activeQueue.textContent : '';
    }
    
    /**
     * 获取活动队列的音频片段
     * @returns {Array} - 音频片段数组
     */
    getActiveAudioChunks() {
        const activeQueue = this.getActiveQueue();
        return activeQueue ? activeQueue.audioChunks : [];
    }
    
    /**
     * 当用户打断时调用，将当前队列标记为非活动
     */
    interruptCurrentQueue() {
        const activeQueue = this.getActiveQueue();
        if (activeQueue) {
            console.log(`打断队列: ${activeQueue.id}`);
            activeQueue.isActive = false;
            this.activeQueueId = null;
        } else {
            console.log('没有活动队列可打断');
        }
    }
    
    /**
     * 检查队列是否存在且活动
     * @param {string} dialogId - 对话ID
     * @returns {boolean} - 是否存在且活动
     */
    isQueueActiveById(dialogId) {
        const queue = this.queues.find(q => q.id === dialogId);
        return queue ? queue.isActive : false;
    }
    
    /**
     * 清空所有队列
     */
    clearAll() {
        this.queues = [];
        this.activeQueueId = null;
    }
}

export default ResponseQueueManager;
