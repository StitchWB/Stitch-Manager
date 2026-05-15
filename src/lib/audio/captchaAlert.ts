/**
 * CAPTCHA audio alert utilities
 * Plays the selected alert sound when manual intervention is required.
 */

let currentAudio: HTMLAudioElement | null = null;

/**
 * Play the configured CAPTCHA alert sound once.
 */
export function playCaptchaAlert(soundFile: string, volume = 0.8): void {
  try {
    // Stop any currently playing alert
    stopCaptchaAlert();

    const audio = new Audio(`/sounds/${soundFile}`);
    audio.volume = volume;
    audio.loop = false;

    // Some browsers block autoplay until user interaction;
    // resume AudioContext if suspended (helps when triggered by user action)
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {
          // ignore
        });
      }
    }

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay blocked or file missing — fail silently
      });
    }

    currentAudio = audio;
  } catch {
    // Silent fail — never break registration flow because of audio
  }
}

/**
 * Stop any playing CAPTCHA alert.
 */
export function stopCaptchaAlert(): void {
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
  } catch {
    // ignore
  }
}
