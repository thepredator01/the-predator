// public/js/converter.js

class CosmicConverter {
  constructor() {
    this.socket = io();
    this.conversionQueue = [];
    this.currentConversion = null;
    this.setupSocketListeners();
  }

  setupSocketListeners() {
    // Progress updates
    this.socket.on('conversion-progress', (data) => {
      this.updateProgress(data);
    });
    
    // Conversion complete
    this.socket.on('conversion-complete', (data) => {
      this.handleComplete(data);
    });
    
    // Error handling
    this.socket.on('conversion-error', (error) => {
      this.handleError(error);
    });
  }

  async convertFiles(files, targetFormat) {
    // Add to queue
    const conversionId = this.generateId();
    this.conversionQueue.push({
      id: conversionId,
      files,
      targetFormat,
      status: 'queued'
    });
    
    // Process queue
    await this.processQueue();
  }

  async processQueue() {
    if (this.currentConversion || this.conversionQueue.length === 0) return;
    
    this.currentConversion = this.conversionQueue.shift();
    this.currentConversion.status = 'processing';
    
    try {
      // Notify UI
      CosmicUI.showConversionStarted(this.currentConversion);
      
      // Prepare FormData
      const formData = new FormData();
      this.currentConversion.files.forEach(file => {
        formData.append('files', file);
      });
      formData.append('targetFormat', this.currentConversion.targetFormat);
      formData.append('conversionId', this.currentConversion.id);
      
      // Start conversion
      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('Conversion failed');
      }
      
      const result = await response.json();
      this.currentConversion.result = result;
      this.currentConversion.status = 'completed';
      
      // Update UI
      CosmicUI.showConversionResult(this.currentConversion);
    } catch (error) {
      this.currentConversion.status = 'failed';
      this.currentConversion.error = error.message;
      CosmicUI.showConversionError(this.currentConversion);
    } finally {
      this.currentConversion = null;
      this.processQueue();
    }
  }

  updateProgress(data) {
    const { conversionId, progress, fileIndex } = data;
    
    // Find the conversion in queue
    const conversion = this.conversionQueue.find(c => c.id === conversionId) || 
                      (this.currentConversion?.id === conversionId ? this.currentConversion : null);
    
    if (conversion) {
      // Update progress in UI
      CosmicUI.updateConversionProgress(conversionId, progress, fileIndex);
    }
  }

  handleComplete(data) {
    const { conversionId, result } = data;
    const conversion = this.conversionQueue.find(c => c.id === conversionId) || 
                      (this.currentConversion?.id === conversionId ? this.currentConversion : null);
    
    if (conversion) {
      conversion.status = 'completed';
      conversion.result = result;
      CosmicUI.showConversionResult(conversion);
    }
  }

  handleError(error) {
    const { conversionId, message } = error;
    const conversion = this.conversionQueue.find(c => c.id === conversionId) || 
                      (this.currentConversion?.id === conversionId ? this.currentConversion : null);
    
    if (conversion) {
      conversion.status = 'failed';
      conversion.error = message;
      CosmicUI.showConversionError(conversion);
    }
  }

  generateId() {
    return Math.random().toString(36).substr(2, 9);
  }

  // Advanced conversion methods
  async convertToPDF(files) {
    // Special handling for PDF conversions
  }

  async extractAudioFromVideo(files) {
    // Special handling for audio extraction
  }

  async createGifFromVideo(files) {
    // Special handling for GIF creation
  }
}

// Initialize converter
document.addEventListener('DOMContentLoaded', () => {
  window.cosmicConverter = new CosmicConverter();
});