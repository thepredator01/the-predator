// public/js/ui.js

class CosmicUI {
  static init() {
    this.themeToggle = document.getElementById('theme-toggle');
    this.resultPanel = document.getElementById('result-panel');
    this.downloadBtn = document.getElementById('download-btn');
    this.cloudUploadBtn = document.getElementById('cloud-upload-btn');
    this.qrCodeContainer = document.getElementById('qr-code-container');
    this.timerElement = document.getElementById('delete-timer');
    this.toastContainer = document.createElement('div');
    
    this.setupThemeToggle();
    this.setupToastContainer();
    this.setupTooltips();
  }

  static setupThemeToggle() {
    const savedTheme = localStorage.getItem('cosmic-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    this.themeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('cosmic-theme', newTheme);
      
      this.showToast(`Switched to ${newTheme} mode`);
    });
  }

  static setupToastContainer() {
    this.toastContainer.className = 'toast-container';
    document.body.appendChild(this.toastContainer);
  }

  static setupTooltips() {
    tippy('[data-tippy-content]', {
      theme: 'cosmic',
      animation: 'scale',
      duration: [200, 150],
      arrow: true
    });
  }

  static showConversionStarted(conversion) {
    // Show loading state for each file
    conversion.files.forEach((file, index) => {
      const fileCard = document.querySelector(`.file-card[data-index="${index}"]`);
      if (fileCard) {
        fileCard.querySelector('.file-status').textContent = 'Converting...';
        fileCard.querySelector('.progress-bar').style.width = '0%';
      }
    });
    
    this.showToast(`Started converting ${conversion.files.length} files to ${conversion.targetFormat.toUpperCase()}`);
  }

  static updateConversionProgress(conversionId, progress, fileIndex) {
    const progressBar = document.querySelector(`.file-card[data-index="${fileIndex}"] .progress-bar`);
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
      
      // Add shimmer effect when progressing
      if (progress > 0 && progress < 100) {
        progressBar.classList.add('shimmer');
      } else {
        progressBar.classList.remove('shimmer');
      }
    }
  }

  static showConversionResult(conversion) {
    this.resultPanel.innerHTML = `
      <div class="results-header">
        <h2>Conversion Complete!</h2>
        <div class="download-options">
          <div class="timer">
            <i class="fas fa-clock"></i>
            <span id="delete-timer">10:00</span>
          </div>
          <button id="download-btn" class="cosmic-btn">
            <i class="fas fa-download"></i> Download All
          </button>
          <button id="cloud-upload-btn" class="cosmic-btn outline">
            <i class="fas fa-cloud-upload-alt"></i> Save to Cloud
          </button>
        </div>
      </div>
      
      <div class="converted-files">
        ${conversion.result.files.map(file => `
          <div class="converted-file">
            <div class="file-preview">
              ${this.getFilePreview(file)}
            </div>
            <div class="file-info">
              <h4>${file.name}</h4>
              <p>${this.formatBytes(file.size)} • ${file.type.toUpperCase()}</p>
              <a href="${file.url}" download class="download-link">
                <i class="fas fa-download"></i> Download
              </a>
            </div>
          </div>
        `).join('')}
      </div>
      
      <div class="qr-section">
        <h3>Scan to download on mobile</h3>
        <div id="qr-code-container"></div>
      </div>
    `;
    
    // Generate QR code
    this.generateQRCode(conversion.result.downloadUrl);
    
    // Set up download button
    this.downloadBtn = document.getElementById('download-btn');
    this.downloadBtn.addEventListener('click', () => {
      this.downloadAllFiles(conversion.result.files);
    });
    
    // Set up cloud upload button
    this.cloudUploadBtn = document.getElementById('cloud-upload-btn');
    this.cloudUploadBtn.addEventListener('click', () => {
      this.showCloudUploadOptions(conversion.result.files);
    });
    
    // Start countdown timer
    this.startCountdown(600); // 10 minutes
    
    // Show result panel
    this.resultPanel.style.display = 'block';
    this.animateResultPanel();
  }

  static animateResultPanel() {
    gsap.from(this.resultPanel, {
      y: 50,
      opacity: 0,
      duration: 0.8,
      ease: 'back.out'
    });
    
    gsap.from('.converted-file', {
      y: 30,
      opacity: 0,
      stagger: 0.1,
      delay: 0.3,
      duration: 0.5,
      ease: 'power2.out'
    });
  }

  static showConversionError(conversion) {
    this.showToast(`Conversion failed: ${conversion.error}`, 'error');
    
    // Update file cards with error state
    conversion.files.forEach((file, index) => {
      const fileCard = document.querySelector(`.file-card[data-index="${index}"]`);
      if (fileCard) {
        fileCard.querySelector('.file-status').textContent = 'Failed';
        fileCard.querySelector('.file-status').style.color = 'var(--cosmic-danger)';
        fileCard.querySelector('.progress-bar').style.width = '100%';
        fileCard.querySelector('.progress-bar').style.background = 'var(--cosmic-danger)';
      }
    });
  }

  static downloadAllFiles(files) {
    files.forEach(file => {
      const link = document.createElement('a');
      link.href = file.url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
    
    this.showToast(`Downloaded ${files.length} files`);
  }

  static showCloudUploadOptions(files) {
    const cloudServices = [
      { name: 'Google Drive', icon: 'fab fa-google-drive', color: '#4285F4' },
      { name: 'Dropbox', icon: 'fab fa-dropbox', color: '#0061FF' },
      { name: 'OneDrive', icon: 'fab fa-microsoft', color: '#0078D4' },
      { name: 'iCloud', icon: 'fas fa-cloud', color: '#3693F3' }
    ];
    
    const modalContent = `
      <div class="cloud-modal">
        <h3>Save to Cloud Storage</h3>
        <p>Select your preferred cloud service:</p>
        
        <div class="cloud-options">
          ${cloudServices.map(service => `
            <div class="cloud-option" 
                 style="--service-color: ${service.color}"
                 data-service="${service.name.toLowerCase()}">
              <i class="${service.icon}"></i>
              <span>${service.name}</span>
            </div>
          `).join('')}
        </div>
        
        <button class="cosmic-btn close-modal">
          <i class="fas fa-times"></i> Cancel
        </button>
      </div>
    `;
    
    this.showModal(modalContent);
    
    // Add event listeners
    document.querySelectorAll('.cloud-option').forEach(option => {
      option.addEventListener('click', () => {
        const service = option.dataset.service;
        this.uploadToCloud(service, files);
      });
    });
    
    document.querySelector('.close-modal').addEventListener('click', this.hideModal);
  }

  static uploadToCloud(service, files) {
    this.showToast(`Uploading ${files.length} files to ${service}...`, 'info');
    this.hideModal();
    
    // Simulate upload (in real app, this would use the cloud service API)
    setTimeout(() => {
      this.showToast(`Files uploaded successfully to ${service}!`, 'success');
    }, 2000);
  }

  static generateQRCode(url) {
    this.qrCodeContainer.innerHTML = '';
    new QRCode(this.qrCodeContainer, {
      text: url,
      width: 180,
      height: 180,
      colorDark: '#6e00ff',
      colorLight: '#0f0b1a',
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  static startCountdown(seconds) {
    let remaining = seconds;
    
    const updateTimer = () => {
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      this.timerElement.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      
      if (remaining <= 0) {
        clearInterval(interval);
        this.timerElement.textContent = 'Expired';
        this.timerElement.style.color = 'var(--cosmic-danger)';
      }
      
      remaining--;
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
  }

  static showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <div class="toast-icon">
        <i class="${this.getToastIcon(type)}"></i>
      </div>
      <div class="toast-message">${message}</div>
      <button class="toast-close">
        <i class="fas fa-times"></i>
      </button>
    `;
    
    this.toastContainer.appendChild(toast);
    
    // Auto-remove after delay
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 5000);
    
    // Close button
    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.remove();
    });
    
    // Animate in
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);
  }

  static getToastIcon(type) {
    const icons = {
      info: 'fas fa-info-circle',
      success: 'fas fa-check-circle',
      warning: 'fas fa-exclamation-circle',
      error: 'fas fa-times-circle'
    };
    return icons[type] || icons.info;
  }

  static getFilePreview(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    const videoTypes = ['mp4', 'mov', 'avi', 'webm'];
    
    if (imageTypes.includes(extension)) {
      return `<img src="${file.url}" alt="${file.name}" class="file-thumbnail">`;
    } else if (videoTypes.includes(extension)) {
      return `
        <video class="file-thumbnail">
          <source src="${file.url}" type="video/mp4">
        </video>
        <div class="play-icon">
          <i class="fas fa-play"></i>
        </div>
      `;
    } else {
      return `
        <div class="file-icon-big">
          <i class="${this.getFileIcon(file.type)}"></i>
          <span class="file-extension">${extension.toUpperCase()}</span>
        </div>
      `;
    }
  }

  static getFileIcon(fileType) {
    const type = fileType.split('/')[0];
    const icons = {
      image: 'fas fa-image',
      video: 'fas fa-video',
      audio: 'fas fa-music',
      application: 'fas fa-file-alt',
      text: 'fas fa-file-alt'
    };
    return icons[type] || 'fas fa-file';
  }

  static formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  static showModal(content) {
    const modal = document.createElement('div');
    modal.className = 'cosmic-modal';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
        ${content}
      </div>
    `;
    
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
    
    // Animate in
    setTimeout(() => {
      modal.classList.add('show');
    }, 10);
  }

  static hideModal() {
    const modal = document.querySelector('.cosmic-modal');
    if (modal) {
      modal.classList.remove('show');
      setTimeout(() => {
        document.body.removeChild(modal);
        document.body.style.overflow = '';
      }, 300);
    }
  }
}

// Initialize UI when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  CosmicUI.init();
});