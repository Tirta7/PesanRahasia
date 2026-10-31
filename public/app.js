(() => {
  'use strict';

  // Elemen DOM Utama
  const createView = document.getElementById('create-view');
  const shareView = document.getElementById('share-view');
  const gateView = document.getElementById('gate-view');
  const secretView = document.getElementById('secret-view');
  const destroyedView = document.getElementById('destroyed-view');

  const createForm = document.getElementById('create-form');
  const secretInput = document.getElementById('secret-input');
  const charCounter = document.getElementById('char-counter');
  const protectionModeSelect = document.getElementById('protection-mode');
  const viewTimerSelect = document.getElementById('view-timer');
  const generateBtn = document.getElementById('generate-btn');

  const generatedLinkInput = document.getElementById('generated-link');
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const copyBtnText = document.getElementById('copy-btn-text');
  const whatsappShareBtn = document.getElementById('whatsapp-share-btn');
  const nativeShareBtn = document.getElementById('native-share-btn');
  const createAnotherBtn = document.getElementById('create-another-btn');

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
  let isMessageActive = false;

  // ============================================================================
  // 1. UTILITAS ENKRIPSI END-TO-END (AES-256-GCM + Fallback untuk Non-HTTPS LAN)
  // ============================================================================

  function bytesToBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
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

  // PRNG stream cipher fallback jika dibuka lewat IP lokal HTTP biasa di HP (di mana crypto.subtle dibatasi browser)
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

    // Fallback untuk koneksi HTTP LAN non-localhost
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

  // ============================================================================
  // 2. UI NAVIGATION & TOAST
  // ============================================================================

  function showView(viewElement) {
    [createView, shareView, gateView, secretView, destroyedView].forEach((el) => {
      el.classList.add('hidden');
    });
    viewElement.classList.remove('hidden');
  }

  let toastTimeout = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.add('hidden');
    }, 3200);
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
      if (!text) {
        showToast('Silakan tulis pesan rahasia terlebih dahulu.');
        return;
      }

      generateBtn.disabled = true;
      const originalBtnHtml = generateBtn.innerHTML;
      generateBtn.innerHTML = '<span>🔐 Mengenkripsi & Membuat Link...</span>';

      try {
        const encrypted = await encryptSecret(text);
        const protectionMode = protectionModeSelect.value;
        const viewTimerSeconds = Number(viewTimerSelect.value) || 60;

        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            protectionMode,
            viewTimerSeconds
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Gagal menyimpan pesan rahasia.');
        }

        // Bangun URL Rahasia menggunakan domain publik Cloudflare Tunnel (https://privatmassage.vocpos.id)
        // dengan #key di fragment (tidak pernah dikirim ke server)
        const baseUrl = (data.publicBaseUrl || 'https://privatmassage.vocpos.id').replace(/\/+$/, '');
        const secretUrl = `${baseUrl}/m/${data.id}#${encrypted.key}`;
        generatedLinkInput.value = secretUrl;

        // Siapkan pesan share WhatsApp
        const waMessage =
          `🔒 *Pesan Rahasia Sekali Baca*\n\n` +
          `Saya mengirimkan pesan rahasia untuk Anda. Pesan ini hanya bisa dibuka *SATU KALI* dan akan otomatis hancur selamanya setelah Anda membukanya:\n\n` +
          `${secretUrl}`;
        whatsappShareBtn.href = `https://wa.me/?text=${encodeURIComponent(waMessage)}`;

        // Bersihkan form input demi keamanan
        secretInput.value = '';
        charCounter.textContent = '0 / 5.000 karakter';

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
      showView(createView);
    });
  }

  // ============================================================================
  // 4. ALUR PENERIMA PESAN: CEK, BUKA & LANGSUNG HANCURKAN (RECIPIENT FLOW)
  // ============================================================================

  function checkRoute() {
    const match = window.location.pathname.match(/^\/m\/([A-Za-z0-9_-]+)$/);
    if (!match) {
      showView(createView);
      return;
    }

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

      // Pesan masih tersedia -> Tampilkan layar konfirmasi buka pesan
      showView(gateView);

      revealConfirmBtn.onclick = () => consumeAndRevealMessage(messageId, keyFromHash);
    } catch {
      showDestroyedScreen(
        'Gagal Memuat Pesan',
        'Tidak dapat terhubung ke server untuk memverifikasi pesan rahasia.'
      );
    }
  }

  async function consumeAndRevealMessage(messageId, keyFromHash) {
    revealConfirmBtn.disabled = true;
    revealConfirmBtn.textContent = '🔥 Menghancurkan dari Server & Membuka Pesan...';

    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(messageId)}/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();
      if (!res.ok) {
        showDestroyedScreen(
          'Pesan Sudah Dihancurkan!',
          data.error || 'Pesan ini baru saja dibuka dan sudah tidak tersedia lagi.'
        );
        return;
      }

      // Dekripsi pesan di browser menggunakan kunci dari hash URL
      const plaintext = await decryptSecret(data.ciphertext, data.iv, keyFromHash);

      // Hapus hash kunci dari address bar & riwayat agar tidak bisa di-refresh/dibuka ulang
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, 'Pesan Rahasia Dihancurkan', `/m/${messageId}`);
      }

      renderSecretProtected(plaintext, data.protectionMode || 'spotlight', data.viewTimerSeconds || 60);
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
    secretTextBlurred.textContent = '';
    secretTextClear.textContent = '';
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
      readerInstruction.textContent = '🔦 Sentuh & geser jari/kursor di dalam kotak untuk menyinari sebagian teks:';
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

  function renderSecretProtected(plaintext, initialMode, timerSeconds) {
    isMessageActive = true;
    secretTextBlurred.textContent = plaintext;
    secretTextClear.textContent = plaintext;
    populateWatermark();
    setProtectionMode(initialMode === 'hold' ? 'hold' : 'spotlight');
    showView(secretView);

    // Jalankan hitung mundur pembersihan layar otomatis
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

  // Event Listener Mode Switcher
  if (modeSpotlightBtn && modeHoldBtn) {
    modeSpotlightBtn.addEventListener('click', () => setProtectionMode('spotlight'));
    modeHoldBtn.addEventListener('click', () => setProtectionMode('hold'));
  }

  // Spotlight Pointer Events (Mouse & Touch)
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
          // Multi-touch (misal gesture screenshot 3 jari di HP) -> langsung tutup!
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

  // Tombol Tahan untuk Baca (Mode Hold)
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

  // Blokir klik kanan / context menu saat membaca pesan
  document.addEventListener('contextmenu', (e) => {
    if (isMessageActive) {
      e.preventDefault();
      showToast('🛡️ Klik kanan dinonaktifkan pada pesan rahasia.');
    }
  });

  // Blokir Copy / Cut saat pesan tampil
  ['copy', 'cut', 'dragstart'].forEach((evtName) => {
    document.addEventListener(evtName, (e) => {
      if (isMessageActive) {
        e.preventDefault();
        showToast('🛡️ Menyalin isi pesan rahasia tidak diizinkan.');
      }
    });
  });

  // Auto-Lock instan ketika jendela kehilangan fokus (misal membuka Snipping Tool / pindah aplikasi / tarik Control Center)
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

  // Deteksi tombol PrintScreen, Cmd+Shift+3/4/5 (macOS), Win+Shift+S, Ctrl+P, Ctrl+S
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

  // Jalankan pengecekan rute saat halaman pertama kali dimuat
  checkRoute();
})();

