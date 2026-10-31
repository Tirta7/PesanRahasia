(() => {
  'use strict';

  const SESSION_STORAGE_KEY = 'pr_session_token';

  // Elemen DOM Utama
  const loginView = document.getElementById('login-view');
  const accountLicenseView = document.getElementById('account-license-view');
  const createView = document.getElementById('create-view');
  const shareView = document.getElementById('share-view');
  const gateView = document.getElementById('gate-view');
  const secretView = document.getElementById('secret-view');
  const destroyedView = document.getElementById('destroyed-view');

  const userProfilePill = document.getElementById('user-profile-pill');
  const vaultPill = document.getElementById('vault-pill');
  const userAvatar = document.getElementById('user-avatar');
  const userNameDisplay = document.getElementById('user-name-display');
  const userVerifiedIcon = document.getElementById('user-verified-icon');
  const userEmailDisplay = document.getElementById('user-email-display');
  const userLicenseBadge = document.getElementById('user-license-badge');
  const logoutBtn = document.getElementById('logout-btn');

  const licAccountName = document.getElementById('lic-account-name');
  const licTitle = document.getElementById('lic-title');
  const licSubtitle = document.getElementById('lic-subtitle');
  const licReasonText = document.getElementById('lic-reason-text');
  const licMachineId = document.getElementById('lic-machine-id');
  const copyMidBtn = document.getElementById('copy-mid-btn');
  const waAdminActivateBtn = document.getElementById('wa-admin-activate-btn');
  const backToTrialBtn = document.getElementById('back-to-trial-btn');
  const switchAccountBtn = document.getElementById('switch-account-btn');
  const licQrisBox = document.getElementById('lic-qris-box');
  const qrisAmount = document.getElementById('qris-amount');
  const qrisMerchant = document.getElementById('qris-merchant');
  const qrisImg = document.getElementById('qris-img');
  const qrisNote = document.getElementById('qris-note');

  const trialQuotaBanner = document.getElementById('trial-quota-banner');
  const trialBannerTitle = document.getElementById('trial-banner-title');
  const trialBannerSub = document.getElementById('trial-banner-sub');
  const trialProgressFill = document.getElementById('trial-progress-fill');
  const openUpgradeBtn = document.getElementById('open-upgrade-btn');

  const gmailLoginForm = document.getElementById('gmail-login-form');
  const loginNameInput = document.getElementById('login-name');
  const loginEmailInput = document.getElementById('login-email');
  const gmailLoginBtn = document.getElementById('gmail-login-btn');
  const googleOauthContainer = document.getElementById('google-oauth-container');
  const btnGoogleOauthPopup = document.getElementById('btn-google-oauth-popup');
  const googleSigninBtn = document.getElementById('google-signin-btn');
  const manualLoginDivider = document.getElementById('manual-login-divider');

  const createForm = document.getElementById('create-form');
  const secretInput = document.getElementById('secret-input');
  const charCounter = document.getElementById('char-counter');
  const secretImageInput = document.getElementById('secret-image-input');
  const imagePreviewBox = document.getElementById('image-preview-box');
  const imagePreviewEl = document.getElementById('image-preview-el');
  const imagePreviewInfo = document.getElementById('image-preview-info');
  const removeImageBtn = document.getElementById('remove-image-btn');
  const protectionModeSelect = document.getElementById('protection-mode');
  const viewTimerSelect = document.getElementById('view-timer');
  const secretPinInput = document.getElementById('secret-pin-input');
  const ttlSelect = document.getElementById('ttl-select');
  const generateBtn = document.getElementById('generate-btn');

  const myMessagesList = document.getElementById('my-messages-list');
  const userPushBtn = document.getElementById('user-push-btn');

  const generatedLinkInput = document.getElementById('generated-link');
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const copyBtnText = document.getElementById('copy-btn-text');
  const sharePinReminder = document.getElementById('share-pin-reminder');
  const sharePinCode = document.getElementById('share-pin-code');
  const whatsappShareBtn = document.getElementById('whatsapp-share-btn');
  const nativeShareBtn = document.getElementById('native-share-btn');
  const createAnotherBtn = document.getElementById('create-another-btn');

  const gatePinBox = document.getElementById('gate-pin-box');
  const gatePinInput = document.getElementById('gate-pin-input');
  const gatePinHint = document.getElementById('gate-pin-hint');
  const revealConfirmBtn = document.getElementById('reveal-confirm-btn');
  const secretStage = document.getElementById('secret-stage');
  const secretTextBlurred = document.getElementById('secret-text-blurred');
  const secretTextClear = document.getElementById('secret-text-clear');
  const privacyShield = document.getElementById('privacy-shield');
  const shieldTitle = document.getElementById('shield-title');
  const shieldDesc = document.getElementById('shield-desc');
  const watermarkLayer = document.getElementById('watermark-layer');

  const modeSpotlightBtn = document.getElementById('mode-spotlight-btn');
  const modeHoldBtn = document.getElementById('mode-hold-btn');
  const readerInstruction = document.getElementById('reader-instruction');
  const holdToReadBtn = document.getElementById('hold-to-read-btn');
  const burnNowBtn = document.getElementById('burn-now-btn');
  const countdownTimerEl = document.getElementById('countdown-timer');

  const destroyedTitle = document.getElementById('destroyed-title');
  const destroyedMessage = document.getElementById('destroyed-message');
  const toastEl = document.getElementById('toast');

  let activeMode = 'spotlight';
  let countdownInterval = null;
  let licensePollInterval = null;
  let myMessagesPollInterval = null;
  let isMessageActive = false;
  let currentUser = null;
  let currentLicense = null;
  let attachedImageDataUrl = '';
  let publicConfig = { googleClientId: '', adminWhatsapp: '', vapidPublicKey: '' };
  let knownPendingIds = null;

  function getSessionToken() {
    try {
      return localStorage.getItem(SESSION_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function setSessionToken(token) {
    try {
      if (token) {
        localStorage.setItem(SESSION_STORAGE_KEY, token);
      } else {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // Abaikan jika storage diblokir
    }
  }

  function playAlertSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      [659.25, 987.77].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.13);
        gain.gain.setValueAtTime(0.15, now + idx * 0.13);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.13 + 0.32);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.13);
        osc.stop(now + idx * 0.13 + 0.34);
      });
    } catch {
      // Abaikan
    }
  }

  // ============================================================================
  // 1. UTILITAS ENKRIPSI END-TO-END (AES-256-GCM + Fallback untuk Non-HTTPS LAN)
  // ============================================================================

  function bytesToBase64Url(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(base64url) {
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function xorStreamCipher(dataBytes, keyBytes, ivBytes) {
    const out = new Uint8Array(dataBytes.length);
    let s0 = 0x9e3779b9;
    let s1 = 0x243f6a88;
    for (let i = 0; i < keyBytes.length; i++) {
      s0 = Math.imul(s0 ^ keyBytes[i], 0x85ebca6b) >>> 0;
      s1 = Math.imul(s1 ^ ivBytes[i % ivBytes.length], 0xc2b2ae35) >>> 0;
    }
    for (let i = 0; i < dataBytes.length; i++) {
      s0 = (s0 + 0x9e3779b9 + (i & 0xff)) >>> 0;
      let z = s0 ^ (s1 + Math.imul(keyBytes[i % keyBytes.length], i + 1));
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      const mask = (z ^ (z >>> 16)) & 0xff;
      out[i] = dataBytes[i] ^ mask;
    }
    return out;
  }

  async function encryptSecret(plaintext) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    const keyBytes = new Uint8Array(32);
    const ivBytes = new Uint8Array(12);
    window.crypto.getRandomValues(keyBytes);
    window.crypto.getRandomValues(ivBytes);

    if (window.crypto && window.crypto.subtle) {
      const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM' },
        false,
        ['encrypt']
      );
      const encryptedBuf = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: ivBytes },
        cryptoKey,
        data
      );
      return {
        ciphertext: bytesToBase64Url(new Uint8Array(encryptedBuf)),
        iv: bytesToBase64Url(ivBytes),
        key: bytesToBase64Url(keyBytes)
      };
    }

    const cipherBytes = xorStreamCipher(data, keyBytes, ivBytes);
    return {
      ciphertext: 'fb.' + bytesToBase64Url(cipherBytes),
      iv: bytesToBase64Url(ivBytes),
      key: bytesToBase64Url(keyBytes)
    };
  }

  async function decryptSecret(ciphertextB64, ivB64, keyB64) {
    const keyBytes = base64UrlToBytes(keyB64);
    const ivBytes = base64UrlToBytes(ivB64);
    const decoder = new TextDecoder();

    if (ciphertextB64.startsWith('fb.')) {
      const cipherBytes = base64UrlToBytes(ciphertextB64.slice(3));
      const plainBytes = xorStreamCipher(cipherBytes, keyBytes, ivBytes);
      return decoder.decode(plainBytes);
    }

    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('Browser memerlukan HTTPS atau localhost untuk mendekripsi AES-GCM.');
    }

    const cipherBytes = base64UrlToBytes(ciphertextB64);
    const cryptoKey = await window.crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const decryptedBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      cryptoKey,
      cipherBytes
    );
    return decoder.decode(decryptedBuf);
  }

  // Kompresi Gambar di Browser sebelum Dienkripsi E2EE
  function compressImageToDataUrl(file, maxDim = 1100, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({ dataUrl, width: w, height: h });
        };
        img.onerror = () => reject(new Error('Gagal membaca file gambar.'));
        img.src = ev.target.result;
      };
      reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      reader.readAsDataURL(file);
    });
  }

  if (secretImageInput) {
    secretImageInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showToast('⚠️ Harap pilih file gambar (JPG, PNG, atau WebP).');
        return;
      }
      try {
        const { dataUrl, width, height } = await compressImageToDataUrl(file);
        attachedImageDataUrl = dataUrl;
        imagePreviewEl.src = dataUrl;
        const sizeKb = Math.round((dataUrl.length * 3) / 4 / 1024);
        imagePreviewInfo.textContent = `🔒 Siap dienkripsi AES-256 (${width}×${height}px • ~${sizeKb} KB)`;
        imagePreviewBox.classList.remove('hidden');
        showToast('🖼️ Gambar berhasil dilampirkan & siap dienkripsi E2EE.');
      } catch (err) {
        showToast('❌ ' + err.message);
      }
    });
  }

  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', () => {
      attachedImageDataUrl = '';
      if (secretImageInput) secretImageInput.value = '';
      if (imagePreviewBox) imagePreviewBox.classList.add('hidden');
    });
  }

  // ============================================================================
  // 2. UI NAVIGATION, TOAST & GMAIL AUTHENTICATION
  // ============================================================================

  function showView(viewElement) {
    [loginView, accountLicenseView, createView, shareView, gateView, secretView, destroyedView].forEach((el) => {
      if (el) el.classList.add('hidden');
    });
    if (viewElement) viewElement.classList.remove('hidden');
  }

  let toastTimeout = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.add('hidden');
    }, 3400);
  }

  function updateUserHeader(user, license) {
    currentUser = user;
    currentLicense = license || currentLicense;
    if (user && user.email) {
      userNameDisplay.textContent = user.name || user.email.split('@')[0];
      userEmailDisplay.textContent = user.email;
      if (userVerifiedIcon) {
        if (user.authProvider === 'google-oauth') {
          userVerifiedIcon.classList.remove('hidden');
        } else {
          userVerifiedIcon.classList.add('hidden');
        }
      }
      userAvatar.src =
        user.picture ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || user.email)}&background=10b981&color=04130d&bold=true`;
      userProfilePill.classList.remove('hidden');
      vaultPill.classList.add('hidden');

      if (userLicenseBadge) {
        if (currentLicense && currentLicense.isTrial) {
          userLicenseBadge.textContent = `🎁 Trial (${currentLicense.trialRemaining}/${currentLicense.trialLimit || 10})`;
          userLicenseBadge.className = 'user-license-badge badge-trial';
          userLicenseBadge.classList.remove('hidden');
        } else if (currentLicense && currentLicense.allowed) {
          userLicenseBadge.textContent =
            currentLicense.daysLeft != null ? `✓ Pro (${currentLicense.daysLeft} hr)` : '✓ Lisensi Pro';
          userLicenseBadge.className = 'user-license-badge';
          userLicenseBadge.classList.remove('hidden');
        } else if (currentLicense) {
          userLicenseBadge.textContent = '🔒 Terkunci';
          userLicenseBadge.className = 'user-license-badge badge-locked';
          userLicenseBadge.classList.remove('hidden');
        } else {
          userLicenseBadge.classList.add('hidden');
        }
      }

      if (trialQuotaBanner) {
        if (currentLicense && currentLicense.isTrial) {
          const limit = currentLicense.trialLimit || 10;
          const rem = currentLicense.trialRemaining ?? limit;
          const pct = Math.max(8, Math.round((rem / limit) * 100));
          trialBannerTitle.textContent = `Kuota Trial Gratis: Sisa ${rem} dari ${limit} Pesan`;
          trialBannerSub.textContent = `ID Lisensi: ${currentLicense.machineId || '-'} • Setelah ${limit} pesan gratis, aktifkan Lisensi Pro Unlimited.`;
          trialProgressFill.style.width = `${pct}%`;
          trialQuotaBanner.classList.remove('hidden');
        } else {
          trialQuotaBanner.classList.add('hidden');
        }
      }
    } else {
      userProfilePill.classList.add('hidden');
      vaultPill.classList.remove('hidden');
      if (trialQuotaBanner) trialQuotaBanner.classList.add('hidden');
    }
  }

  function renderAccountLicenseScreen(user, license) {
    if (licTitle && licSubtitle) {
      if (license?.status === 'trial_exhausted') {
        licTitle.textContent = 'Kuota Trial 10x Pesan Habis';
        licSubtitle.innerHTML =
          'Anda telah menggunakan seluruh <strong>10x kuota pesan rahasia gratis</strong>. Untuk terus membuat pesan tanpa batas, aktifkan lisensi akun Anda di bawah ini.';
      } else if (license?.isTrial) {
        licTitle.textContent = 'Informasi Lisensi Akun Pro';
        licSubtitle.innerHTML =
          `Anda masih memiliki <strong>${license.trialRemaining} dari ${license.trialLimit || 10} kuota pesan gratis</strong>. Anda juga dapat mengaktifkan Lisensi Pro lebih awal.`;
      } else {
        licTitle.textContent = 'Aktivasi Lisensi Akun Diperlukan';
        licSubtitle.innerHTML =
          'Akun Gmail Anda telah terdaftar di sistem lisensi <strong>VOC ML</strong> dan sedang menunggu aktivasi.';
      }
    }

    if (backToTrialBtn) {
      if (license?.allowed && license?.isTrial) {
        backToTrialBtn.classList.remove('hidden');
      } else {
        backToTrialBtn.classList.add('hidden');
      }
    }

    if (licAccountName) {
      licAccountName.textContent = `${user.name} (${user.email})`;
    }
    if (licReasonText) {
      licReasonText.textContent = license?.reason || 'Menunggu Aktivasi Lisensi di Dashboard VOC ML';
    }
    if (licMachineId) {
      licMachineId.textContent = license?.machineId || '-';
    }

    if (waAdminActivateBtn) {
      const waText =
        `Halo Admin *PesanRahasia*,\n\n` +
        `Saya ingin mengaktifkan *Lisensi Pro Unlimited* untuk akun saya:\n` +
        `• Nama: *${user.name}*\n` +
        `• Email Gmail: *${user.email}*\n` +
        `• ID Lisensi (VOC ML): *${license?.machineId || '-'}*\n\n` +
        `Mohon bantuannya untuk aktivasi. Terima kasih!`;
      const targetPhone = publicConfig.adminWhatsapp || '';
      waAdminActivateBtn.href = targetPhone
        ? `https://wa.me/${targetPhone}?text=${encodeURIComponent(waText)}`
        : `https://wa.me/?text=${encodeURIComponent(waText)}`;
    }

    if (licQrisBox && license?.billing && (license.billing.qris || license.billing.qris_image_url)) {
      const b = license.billing;
      qrisAmount.textContent = b.amount_text || `Rp ${(b.amount || 0).toLocaleString('id-ID')}`;
      qrisMerchant.textContent = [b.merchant_name, b.merchant_city].filter(Boolean).join(' • ');
      qrisImg.src =
        b.qris_image_url ||
        `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(b.qris)}`;
      if (b.note) qrisNote.textContent = b.note;
      licQrisBox.classList.remove('hidden');
    } else if (licQrisBox) {
      licQrisBox.classList.add('hidden');
    }

    showView(accountLicenseView);
    startLicensePolling();
  }

  function startLicensePolling() {
    clearInterval(licensePollInterval);
    licensePollInterval = setInterval(async () => {
      const token = getSessionToken();
      if (!token) {
        clearInterval(licensePollInterval);
        return;
      }
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store'
        });
        if (!res.ok) return;
        const data = await res.json();
        updateUserHeader(data.user, data.license);
        if (data.license && data.license.allowed && (!data.license.isTrial || accountLicenseView.classList.contains('hidden') === false)) {
          if (!data.license.isTrial || (currentLicense && !currentLicense.allowed && data.license.allowed)) {
            clearInterval(licensePollInterval);
            showView(createView);
            loadMyMessages();
            showToast('🎉 Akun Gmail Anda telah aktif! Silakan buat pesan rahasia.');
          }
        } else if (data.license && licReasonText) {
          licReasonText.textContent = data.license.reason;
        }
      } catch {
        // Abaikan error jaringan sementara
      }
    }, 5000);
  }

  // ============================================================================
  // 2B. RIWAYAT LINK PESAN PENGIRIM & WEB PUSH READ-RECEIPT
  // ============================================================================

  function formatShortTime(d) {
    if (!d) return '-';
    return new Date(d).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async function loadMyMessages() {
    const token = getSessionToken();
    if (!token || !myMessagesList) return;
    try {
      const res = await fetch('/api/my-messages', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (!res.ok) return;
      const { logs } = await res.json();
      renderMyMessages(logs || []);
    } catch {
      // Abaikan
    }
  }

  function renderMyMessages(logs) {
    if (!myMessagesList) return;

    // Deteksi jika ada pesan milik pengirim yang baru saja dibuka oleh penerima
    if (knownPendingIds !== null) {
      for (const l of logs) {
        if (l.status === 'destroyed' && knownPendingIds.has(l.id)) {
          playAlertSound();
          showToast(`🔥 Pesan #${l.id} baru saja dibuka & dihancurkan! (${formatShortTime(l.openedAt)})`);
        }
      }
    }
    knownPendingIds = new Set(logs.filter((l) => l.status === 'pending').map((l) => l.id));

    if (!logs.length) {
      myMessagesList.innerHTML = '<div class="my-msg-empty">Belum ada riwayat link pesan yang Anda buat.</div>';
      return;
    }

    myMessagesList.innerHTML = logs
      .map((l) => {
        let statusPill = '<span class="status-pill-mini pending">⏳ Menunggu Dibuka</span>';
        let subText = `Dibuat: ${formatShortTime(l.createdAt)} • Batas: ${formatShortTime(l.expiresAt)}`;
        if (l.status === 'destroyed') {
          statusPill = '<span class="status-pill-mini destroyed">🔥 Sudah Dibuka & Hancur</span>';
          subText = `🔥 Dibuka pada ${formatShortTime(l.openedAt)}`;
        } else if (l.status === 'expired') {
          statusPill = '<span class="status-pill-mini expired">⌛ Kedaluwarsa</span>';
        }

        const tags = [];
        if (l.hasPin) tags.push('<span class="mini-tag">🔑 PIN</span>');
        if (l.hasImage) tags.push('<span class="mini-tag">🖼️ Gambar</span>');
        tags.push(`<span class="mini-tag">${l.protectionMode === 'hold' ? '👆 Hold' : '🔦 Spotlight'}</span>`);

        return `
          <div class="my-msg-card">
            <div class="my-msg-left">
              <div class="my-msg-id-row">
                <span class="my-msg-id">#${l.id}</span>
                ${tags.join('')}
              </div>
              <span class="my-msg-sub">${subText}</span>
            </div>
            <div class="my-msg-right">
              ${statusPill}
              ${
                l.status === 'pending'
                  ? `<button type="button" class="btn-revoke-mini js-revoke-my-msg" data-id="${l.id}" title="Batalkan & hancurkan link ini sebelum dibuka penerima">🔥 Batalkan</button>`
                  : ''
              }
            </div>
          </div>
        `;
      })
      .join('');
  }

  if (myMessagesList) {
    myMessagesList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.js-revoke-my-msg');
      if (!btn) return;
      const msgId = btn.dataset.id;
      if (!confirm(`Batalkan dan hancurkan pesan #${msgId} sekarang sehingga tidak bisa dibuka lagi?`)) return;
      const token = getSessionToken();
      try {
        const res = await fetch(`/api/my-messages/${encodeURIComponent(msgId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          knownPendingIds?.delete(msgId);
          showToast(`🔥 Link pesan #${msgId} berhasil dibatalkan & dihancurkan.`);
          loadMyMessages();
        }
      } catch {
        showToast('⚠️ Gagal membatalkan pesan.');
      }
    });
  }

  function startMyMessagesPolling() {
    clearInterval(myMessagesPollInterval);
    loadMyMessages();
    myMessagesPollInterval = setInterval(() => {
      if (getSessionToken() && !isMessageActive) {
        loadMyMessages();
      }
    }, 8000);
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/\//g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function subscribeUserReadReceiptPush() {
    const token = getSessionToken();
    if (!token) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      alert('Untuk menerima notifikasi di iPhone/iPad, silakan klik "Install Aplikasi" / "Add to Home Screen" terlebih dahulu.');
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        showToast('⚠️ Izin notifikasi ditolak di browser.');
        return;
      }

      if (!publicConfig.vapidPublicKey) {
        const cfgRes = await fetch('/api/auth/config');
        publicConfig = await cfgRes.json();
      }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicConfig.vapidPublicKey)
      });

      const res = await fetch('/api/user/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ subscription: sub })
      });

      if (res.ok) {
        if (userPushBtn) {
          userPushBtn.textContent = '✓ Notif Dibuka Aktif';
          userPushBtn.classList.add('active');
        }
        playAlertSound();
        showToast('🔔 Aktif! HP Anda akan menerima notifikasi saat pesan rahasia dibuka penerima.');
      }
    } catch (err) {
      showToast('⚠️ Gagal mengaktifkan notifikasi: ' + err.message);
    }
  }

  if (userPushBtn) {
    userPushBtn.addEventListener('click', subscribeUserReadReceiptPush);
  }

  function applyAuthAndLicenseState(user, license, isFreshLogin = false) {
    updateUserHeader(user, license);
    if (license && !license.allowed) {
      renderAccountLicenseScreen(user, license);
      if (isFreshLogin) {
        showToast('🔒 Kuota Trial 10x pesan telah habis. Silakan aktifkan lisensi akun Anda.');
      }
      return;
    }
    clearInterval(licensePollInterval);
    showView(createView);
    startMyMessagesPolling();
    if (isFreshLogin) {
      if (license && license.isTrial) {
        showToast(`🎁 Selamat datang ${user.name}! Anda mendapat Trial Gratis (${license.trialRemaining}/${license.trialLimit || 10} pesan).`);
      } else {
        showToast(`👋 Selamat datang kembali, ${user.name}!`);
      }
    }
  }

  let googleTokenClient = null;

  async function loadPublicConfigAndGoogleOAuth() {
    try {
      const res = await fetch('/api/auth/config', { cache: 'no-store' });
      publicConfig = await res.json();

      if (publicConfig.strictGoogleOAuth && publicConfig.googleClientId) {
        if (gmailLoginForm) gmailLoginForm.classList.add('hidden');
        if (manualLoginDivider) manualLoginDivider.classList.add('hidden');
      } else {
        if (gmailLoginForm) gmailLoginForm.classList.remove('hidden');
        if (manualLoginDivider) manualLoginDivider.classList.remove('hidden');
      }

      const setupGoogleSdk = () => {
        if (!publicConfig.googleClientId || !window.google || !window.google.accounts) return;

        // 1. Google Identity Services (ID Token / One-Tap)
        if (window.google.accounts.id) {
          window.google.accounts.id.initialize({
            client_id: publicConfig.googleClientId,
            callback: async (response) => {
              if (response.credential) {
                await handleGoogleLoginRequest({ credential: response.credential });
              }
            }
          });
          if (googleSigninBtn) {
            window.google.accounts.id.renderButton(googleSigninBtn, {
              theme: 'filled_black',
              size: 'large',
              shape: 'pill',
              text: 'continue_with',
              width: 320
            });
          }
        }

        // 2. Google OAuth 2.0 Popup Client (1-Click Account Chooser + Foto Profil Asli)
        if (window.google.accounts.oauth2) {
          googleTokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: publicConfig.googleClientId,
            scope: 'openid email profile',
            callback: async (tokenResponse) => {
              if (tokenResponse && tokenResponse.access_token) {
                await handleGoogleLoginRequest({ accessToken: tokenResponse.access_token });
              }
            }
          });
        }
      };

      setupGoogleSdk();
      // Jika script GSI Google baru selesai dimuat sedikit belakangan
      setTimeout(setupGoogleSdk, 1200);
    } catch {
      // Gunakan form Gmail langsung jika gagal memuat config
    }
  }

  if (btnGoogleOauthPopup) {
    btnGoogleOauthPopup.addEventListener('click', () => {
      if (googleTokenClient) {
        googleTokenClient.requestAccessToken({ prompt: 'select_account' });
        return;
      }
      if (publicConfig.googleClientId && window.google?.accounts?.id) {
        window.google.accounts.id.prompt();
        return;
      }
      showToast('ℹ️ Masukkan Google Client ID di /admin (Setelan Google OAuth) untuk mengaktifkan popup resmi Google, atau gunakan form Gmail di bawah.');
      if (loginNameInput) loginNameInput.focus();
    });
  }

  async function handleGoogleLoginRequest(payload) {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal masuk dengan akun Gmail.');
      }

      setSessionToken(data.token);
      applyAuthAndLicenseState(data.user, data.license, true);
    } catch (err) {
      showToast('❌ ' + (err.message || 'Gagal login dengan Gmail.'));
    }
  }

  if (copyMidBtn) {
    copyMidBtn.addEventListener('click', async () => {
      const mid = licMachineId?.textContent || '';
      if (!mid) return;
      try {
        await navigator.clipboard.writeText(mid);
        showToast('📋 ID Lisensi Akun berhasil disalin!');
      } catch {
        // Abaikan
      }
    });
  }

  if (switchAccountBtn) {
    switchAccountBtn.addEventListener('click', () => {
      if (logoutBtn) logoutBtn.click();
    });
  }

  if (openUpgradeBtn) {
    openUpgradeBtn.addEventListener('click', () => {
      if (currentUser && currentLicense) {
        renderAccountLicenseScreen(currentUser, currentLicense);
      }
    });
  }

  if (backToTrialBtn) {
    backToTrialBtn.addEventListener('click', () => {
      clearInterval(licensePollInterval);
      showView(createView);
      startMyMessagesPolling();
    });
  }

  if (gmailLoginForm) {
    gmailLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = loginNameInput.value.trim();
      const email = loginEmailInput.value.trim().toLowerCase();

      if (!/^[a-z0-9._%+-]+@gmail\.com$/i.test(email)) {
        showToast('⚠️ Harap gunakan alamat email berakhiran @gmail.com');
        return;
      }

      gmailLoginBtn.disabled = true;
      await handleGoogleLoginRequest({ name, email });
      gmailLoginBtn.disabled = false;
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const token = getSessionToken();
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => {});
      }
      clearInterval(licensePollInterval);
      clearInterval(myMessagesPollInterval);
      setSessionToken('');
      updateUserHeader(null);
      showView(loginView);
      showToast('Anda telah keluar dari akun Gmail.');
    });
  }

  // ============================================================================
  // 3. PEMBUATAN LINK PESAN RAHASIA (SENDER FLOW)
  // ============================================================================

  if (secretInput) {
    secretInput.addEventListener('input', () => {
      const len = secretInput.value.length;
      charCounter.textContent = `${len.toLocaleString('id-ID')} / 5.000 karakter`;
    });
  }

  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = secretInput.value.trim();
      const pin = secretPinInput ? secretPinInput.value.trim() : '';

      if (!text && !attachedImageDataUrl) {
        showToast('Silakan tulis pesan rahasia atau lampirkan gambar terlebih dahulu.');
        return;
      }

      if (pin && (pin.length < 4 || pin.length > 16)) {
        showToast('⚠️ PIN Pengaman harus terdiri dari 4 hingga 16 karakter.');
        return;
      }

      const token = getSessionToken();
      if (!token) {
        showToast('Silakan masuk dengan akun Gmail terlebih dahulu.');
        showView(loginView);
        return;
      }

      generateBtn.disabled = true;
      const originalBtnHtml = generateBtn.innerHTML;
      generateBtn.innerHTML = '<span>🔐 Mengenkripsi AES-256 & Membuat Link...</span>';

      try {
        const hasImage = Boolean(attachedImageDataUrl);
        const payloadToEncrypt = hasImage
          ? JSON.stringify({ __prBundle: 1, text, image: attachedImageDataUrl })
          : text;

        const encrypted = await encryptSecret(payloadToEncrypt);
        const protectionMode = protectionModeSelect.value;
        const viewTimerSeconds = Number(viewTimerSelect.value) || 60;
        const ttlMinutes = ttlSelect ? Number(ttlSelect.value) || 1440 : 1440;

        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            pin,
            hasImage,
            ttlMinutes,
            protectionMode,
            viewTimerSeconds
          })
        });

        const data = await res.json();
        if (res.status === 401) {
          setSessionToken('');
          updateUserHeader(null);
          showView(loginView);
          throw new Error('Sesi login Gmail telah habis, silakan masuk kembali.');
        }

        if (res.status === 403 && data.license) {
          applyAuthAndLicenseState(currentUser, data.license, false);
          throw new Error(data.error || 'Lisensi akun Gmail Anda belum aktif.');
        }

        if (!res.ok) {
          throw new Error(data.error || 'Gagal menyimpan pesan rahasia.');
        }

        if (data.user || data.license) {
          updateUserHeader(data.user || currentUser, data.license || currentLicense);
        }

        const baseUrl = (data.publicBaseUrl || 'https://privatmassage.vocpos.id').replace(/\/+$/, '');
        const secretUrl = `${baseUrl}/m/${data.id}#${encrypted.key}`;
        generatedLinkInput.value = secretUrl;

        if (sharePinReminder && sharePinCode) {
          if (pin) {
            sharePinCode.textContent = pin;
            sharePinReminder.classList.remove('hidden');
          } else {
            sharePinReminder.classList.add('hidden');
          }
        }

        const pinNote = pin ? `\n🔑 *PIN Pembuka:* ${pin}\n` : '\n';
        const waMessage =
          `🔒 *Pesan Rahasia Sekali Baca*\n\n` +
          `Saya mengirimkan pesan rahasia untuk Anda. Pesan ini hanya bisa dibuka *SATU KALI* dan akan otomatis hancur selamanya setelah Anda membukanya:\n` +
          pinNote +
          `\n${secretUrl}`;
        whatsappShareBtn.href = `https://wa.me/?text=${encodeURIComponent(waMessage)}`;

        secretInput.value = '';
        if (secretPinInput) secretPinInput.value = '';
        attachedImageDataUrl = '';
        if (secretImageInput) secretImageInput.value = '';
        if (imagePreviewBox) imagePreviewBox.classList.add('hidden');
        charCounter.textContent = '0 / 5.000 karakter';

        loadMyMessages();
        showView(shareView);
        showToast('✅ Link pesan rahasia berhasil dibuat!');
      } catch (err) {
        showToast('❌ ' + (err.message || 'Terjadi kesalahan.'));
      } finally {
        generateBtn.disabled = false;
        generateBtn.innerHTML = originalBtnHtml;
      }
    });
  }

  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', async () => {
      const link = generatedLinkInput.value;
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
        copyBtnText.textContent = '✓ Tersalin!';
        showToast('📋 Link berhasil disalin ke clipboard!');
        setTimeout(() => {
          copyBtnText.textContent = 'Salin Link';
        }, 2000);
      } catch {
        generatedLinkInput.select();
        document.execCommand('copy');
        showToast('📋 Link berhasil disalin!');
      }
    });
  }

  if (nativeShareBtn) {
    nativeShareBtn.addEventListener('click', async () => {
      const link = generatedLinkInput.value;
      if (navigator.share) {
        try {
          await navigator.share({
            title: '🔒 Pesan Rahasia Sekali Baca',
            text: 'Buka pesan rahasia ini (otomatis hancur setelah dibuka satu kali):',
            url: link
          });
        } catch {
          // Pengguna membatalkan dialog share
        }
      } else {
        copyLinkBtn.click();
      }
    });
  }

  if (createAnotherBtn) {
    createAnotherBtn.addEventListener('click', () => {
      generatedLinkInput.value = '';
      if (currentLicense && !currentLicense.allowed) {
        renderAccountLicenseScreen(currentUser, currentLicense);
        showToast('🔒 Kuota Trial 10x pesan gratis Anda telah habis. Silakan aktifkan lisensi akun.');
        return;
      }
      loadMyMessages();
      showView(createView);
    });
  }

  // ============================================================================
  // 4. ALUR PENERIMA PESAN: CEK, VERIFIKASI PIN, BUKA & HANCURKAN (RECIPIENT)
  // ============================================================================

  async function checkRoute() {
    await loadPublicConfigAndGoogleOAuth();

    const match = window.location.pathname.match(/^\/m\/([A-Za-z0-9_-]+)$/);
    if (match) {
      const messageId = match[1];
      const keyFromHash = window.location.hash.replace(/^#/, '').trim();

      if (!keyFromHash) {
        showDestroyedScreen(
          'Kunci Dekripsi Tidak Lengkap',
          'Link yang Anda buka tidak memiliki kunci dekripsi (#key) yang valid atau sudah tidak utuh.'
        );
        return;
      }

      verifyMessageExists(messageId, keyFromHash);
      return;
    }

    const token = getSessionToken();
    if (token) {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          applyAuthAndLicenseState(data.user, data.license, false);
          return;
        }
      } catch {
        // Lanjut ke layar login
      }
      setSessionToken('');
    }

    updateUserHeader(null);
    showView(loginView);
  }

  async function verifyMessageExists(messageId, keyFromHash) {
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(messageId)}/meta`, {
        method: 'GET',
        cache: 'no-store'
      });

      if (!res.ok) {
        showDestroyedScreen(
          'Pesan Sudah Hancur / Tidak Berlaku',
          'Pesan rahasia ini sudah pernah dibuka sebelumnya dan telah dihancurkan secara permanen dari server, atau link sudah kedaluwarsa.'
        );
        return;
      }

      const meta = await res.json();
      if (gatePinBox) {
        if (meta.hasPin) {
          gatePinBox.classList.remove('hidden');
          if (gatePinInput) gatePinInput.value = '';
        } else {
          gatePinBox.classList.add('hidden');
        }
      }

      showView(gateView);
      revealConfirmBtn.onclick = () => consumeAndRevealMessage(messageId, keyFromHash, Boolean(meta.hasPin));
    } catch {
      showDestroyedScreen(
        'Gagal Memuat Pesan',
        'Tidak dapat terhubung ke server untuk memverifikasi pesan rahasia.'
      );
    }
  }

  async function consumeAndRevealMessage(messageId, keyFromHash, requiresPin = false) {
    const pinVal = gatePinInput ? gatePinInput.value.trim() : '';
    if (requiresPin && !pinVal) {
      showToast('🔑 Silakan masukkan PIN Rahasia dari pengirim terlebih dahulu.');
      if (gatePinInput) gatePinInput.focus();
      return;
    }

    revealConfirmBtn.disabled = true;
    const origBtnText = revealConfirmBtn.textContent;
    revealConfirmBtn.textContent = '🔥 Memverifikasi & Membuka Pesan...';

    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(messageId)}/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinVal })
      });

      const data = await res.json();

      // Jika PIN salah namun masih ada sisa percobaan, jangan hancurkan tampilan Gate
      if (res.status === 403 && data.invalidPin) {
        revealConfirmBtn.disabled = false;
        revealConfirmBtn.textContent = origBtnText;
        if (gatePinHint) {
          gatePinHint.style.color = '#fca5a5';
          gatePinHint.textContent = data.error;
        }
        showToast('❌ ' + data.error);
        return;
      }

      if (!res.ok) {
        showDestroyedScreen(
          'Pesan Sudah Dihancurkan!',
          data.error || 'Pesan ini baru saja dibuka dan sudah tidak tersedia lagi.'
        );
        return;
      }

      const decryptedRaw = await decryptSecret(data.ciphertext, data.iv, keyFromHash);

      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, 'Pesan Rahasia Dihancurkan', `/m/${messageId}`);
      }

      renderSecretProtected(decryptedRaw, data.protectionMode || 'spotlight', data.viewTimerSeconds || 60);
    } catch {
      showDestroyedScreen(
        'Gagal Mendekripsi Pesan',
        'Kunci rahasia pada link tidak cocok atau pesan telah rusak. Karena pesan bersifat sekali baca, salinan di server telah dihancurkan.'
      );
    }
  }

  function showDestroyedScreen(title, message) {
    isMessageActive = false;
    clearInterval(countdownInterval);
    secretTextBlurred.innerHTML = '';
    secretTextClear.innerHTML = '';
    if (title) destroyedTitle.textContent = title;
    if (message) destroyedMessage.textContent = message;
    showView(destroyedView);
  }

  // ============================================================================
  // 5. PROTEKSI ANTI-SCREENSHOT, SPOTLIGHT, PRESS-AND-HOLD & AUTO-BURN
  // ============================================================================

  function populateWatermark() {
    watermarkLayer.innerHTML = '';
    const stamp = `RAHASIA • SEKALI BACA • ${new Date().toLocaleTimeString('id-ID')}`;
    for (let i = 0; i < 28; i++) {
      const span = document.createElement('span');
      span.textContent = stamp;
      watermarkLayer.appendChild(span);
    }
  }

  function setProtectionMode(mode) {
    activeMode = mode;
    secretStage.classList.remove('mode-spotlight', 'mode-hold', 'is-holding');
    modeSpotlightBtn.classList.toggle('active', mode === 'spotlight');
    modeHoldBtn.classList.toggle('active', mode === 'hold');

    if (mode === 'spotlight') {
      secretStage.classList.add('mode-spotlight');
      readerInstruction.textContent = '🔦 Sentuh & geser jari/kursor di dalam kotak untuk menyinari sebagian pesan:';
      holdToReadBtn.classList.add('hidden');
      shieldTitle.textContent = 'Mode Spotlight Anti-Screenshot Aktif';
      shieldDesc.textContent = 'Sentuh atau arahkan kursor ke dalam kotak ini untuk membaca pesan melalui lubang intip.';
      lockStageShield();
    } else {
      secretStage.classList.add('mode-hold');
      readerInstruction.textContent = '👆 Tahan tombol di bawah untuk membuka blur pesan:';
      holdToReadBtn.classList.remove('hidden');
      shieldTitle.textContent = 'Layar Terkunci (Mode Tahan Tombol)';
      shieldDesc.textContent = 'Tekan dan tahan tombol "Tahan Tombol Ini Untuk Membuka Blur" di bawah untuk membaca.';
      lockStageShield();
    }
  }

  function lockStageShield(customReason) {
    secretStage.style.setProperty('--spot-x', '-999px');
    secretStage.style.setProperty('--spot-y', '-999px');
    secretStage.classList.remove('is-holding');
    holdToReadBtn.classList.remove('holding');
    if (customReason) {
      shieldTitle.textContent = '⚠️ Proteksi Anti-Screenshot Aktif!';
      shieldDesc.textContent = customReason;
    }
    privacyShield.classList.remove('shield-hidden');
  }

  function unlockStageShield() {
    privacyShield.classList.add('shield-hidden');
  }

  function populateSecretLayer(container, text, imageDataUrl) {
    container.innerHTML = '';
    if (text) {
      const p = document.createElement('div');
      p.textContent = text;
      container.appendChild(p);
    }
    if (imageDataUrl && imageDataUrl.startsWith('data:image/')) {
      const img = document.createElement('img');
      img.src = imageDataUrl;
      img.alt = 'Lampiran Rahasia Sekali Lihat';
      img.className = 'secret-image-render';
      container.appendChild(img);
    }
  }

  function renderSecretProtected(decryptedRaw, initialMode, timerSeconds) {
    isMessageActive = true;

    let textContent = decryptedRaw;
    let imageDataUrl = '';
    try {
      if (decryptedRaw.startsWith('{')) {
        const parsed = JSON.parse(decryptedRaw);
        if (parsed && parsed.__prBundle === 1) {
          textContent = parsed.text || '';
          imageDataUrl = parsed.image || '';
        }
      }
    } catch {
      textContent = decryptedRaw;
    }

    populateSecretLayer(secretTextBlurred, textContent, imageDataUrl);
    populateSecretLayer(secretTextClear, textContent, imageDataUrl);

    populateWatermark();
    setProtectionMode(initialMode === 'hold' ? 'hold' : 'spotlight');
    showView(secretView);

    let remaining = timerSeconds;
    countdownTimerEl.textContent = `${remaining}d`;
    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      remaining -= 1;
      countdownTimerEl.textContent = `${remaining}d`;
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        burnMessageFromScreen('Waktu baca habis. Pesan telah dihapus dari layar dan tidak dapat dibuka kembali.');
      }
    }, 1000);
  }

  function burnMessageFromScreen(reasonText) {
    showDestroyedScreen(
      '🔥 Pesan Telah Dihancurkan Selamanya',
      reasonText || 'Pesan rahasia telah dihapus dari server maupun layar perangkat Anda. Link ini sudah hangus dan tidak bisa dibuka dua kali.'
    );
    showToast('🔥 Pesan rahasia telah dihancurkan.');
  }

  if (modeSpotlightBtn && modeHoldBtn) {
    modeSpotlightBtn.addEventListener('click', () => setProtectionMode('spotlight'));
    modeHoldBtn.addEventListener('click', () => setProtectionMode('hold'));
  }

  function updateSpotlightPosition(clientX, clientY) {
    if (!isMessageActive || activeMode !== 'spotlight') return;
    const rect = secretStage.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    unlockStageShield();
    secretStage.style.setProperty('--spot-x', `${x}px`);
    secretStage.style.setProperty('--spot-y', `${y}px`);
  }

  if (secretStage) {
    secretStage.addEventListener('mousemove', (e) => {
      updateSpotlightPosition(e.clientX, e.clientY);
    });

    secretStage.addEventListener('mouseleave', () => {
      if (activeMode === 'spotlight') {
        lockStageShield();
      }
    });

    secretStage.addEventListener(
      'touchstart',
      (e) => {
        if (activeMode === 'spotlight' && e.touches.length === 1) {
          updateSpotlightPosition(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length > 1) {
          lockStageShield('Gesture multi-sentuhan terdeteksi. Demi keamanan, pesan disembunyikan.');
        }
      },
      { passive: true }
    );

    secretStage.addEventListener(
      'touchmove',
      (e) => {
        if (activeMode === 'spotlight' && e.touches.length === 1) {
          e.preventDefault();
          updateSpotlightPosition(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length > 1) {
          lockStageShield('Gesture multi-sentuhan terdeteksi. Demi keamanan, pesan disembunyikan.');
        }
      },
      { passive: false }
    );

    secretStage.addEventListener('touchend', () => {
      if (activeMode === 'spotlight') {
        lockStageShield();
      }
    });
  }

  function startHolding(e) {
    if (!isMessageActive || activeMode !== 'hold') return;
    if (e.cancelable) e.preventDefault();
    holdToReadBtn.classList.add('holding');
    secretStage.classList.add('is-holding');
    unlockStageShield();
  }

  function stopHolding() {
    if (!isMessageActive || activeMode !== 'hold') return;
    lockStageShield();
  }

  if (holdToReadBtn) {
    holdToReadBtn.addEventListener('mousedown', startHolding);
    holdToReadBtn.addEventListener('touchstart', startHolding, { passive: false });
    window.addEventListener('mouseup', stopHolding);
    window.addEventListener('touchend', stopHolding);
    window.addEventListener('touchcancel', stopHolding);
  }

  if (burnNowBtn) {
    burnNowBtn.addEventListener('click', () => {
      burnMessageFromScreen('Anda telah menghancurkan pesan ini dari layar. Link sudah tidak berlaku lagi.');
    });
  }

  // ============================================================================
  // 6. SENSOR DETEKSI SCREENSHOT, PINDAH TAB, KLIK KANAN & COPY-PASTE
  // ============================================================================

  document.addEventListener('contextmenu', (e) => {
    if (isMessageActive) {
      e.preventDefault();
      showToast('🛡️ Klik kanan dinonaktifkan pada pesan rahasia.');
    }
  });

  ['copy', 'cut', 'dragstart'].forEach((evtName) => {
    document.addEventListener(evtName, (e) => {
      if (isMessageActive) {
        e.preventDefault();
        showToast('🛡️ Menyalin isi pesan rahasia tidak diizinkan.');
      }
    });
  });

  window.addEventListener('blur', () => {
    if (isMessageActive) {
      lockStageShield('Jendela kehilangan fokus. Pesan otomatis disembunyikan untuk mencegah tangkapan layar.');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isMessageActive) {
      lockStageShield('Anda berpindah tab/aplikasi. Pesan disembunyikan secara otomatis.');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!isMessageActive) return;

    const isPrintScreen = e.key === 'PrintScreen' || e.keyCode === 44;
    const isMacScreenshot = e.metaKey && e.shiftKey && ['3', '4', '5', 's', 'S'].includes(e.key);
    const isWinSnip = (e.metaKey || e.ctrlKey) && e.shiftKey && ['s', 'S'].includes(e.key);
    const isPrintOrSave = (e.ctrlKey || e.metaKey) && ['p', 'P', 's', 'S', 'c', 'C', 'u', 'U'].includes(e.key);

    if (isPrintScreen || isMacScreenshot || isWinSnip || isPrintOrSave) {
      e.preventDefault();
      lockStageShield('Percobaan tangkapan layar / shortcut terdeteksi! Pesan langsung dikunci.');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText('🔒 [Pesan Rahasia Dilindungi Anti-Screenshot]').catch(() => {});
      }
      showToast('🛡️ Proteksi Aktif: Tangkapan layar & salin teks diblokir!');
    }
  });

  window.addEventListener('keyup', (e) => {
    if (!isMessageActive) return;
    if (e.key === 'PrintScreen' || e.keyCode === 44) {
      lockStageShield('Tombol PrintScreen terdeteksi! Pesan telah disembunyikan.');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText('🔒 [Pesan Rahasia Dilindungi Anti-Screenshot]').catch(() => {});
      }
      showToast('🛡️ Screenshot terdeteksi! Layar dikunci.');
    }
  });

  checkRoute();
})();
