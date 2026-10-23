if (!window.__babilCaptureController) {
  window.__babilCaptureController = true;
  let stream;
  let context;

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'capture-stop') stopCapture();
    if (message.type === 'capture-start') startCapture();
  });

  function stopCapture() {
    stream?.getTracks().forEach((track) => track.stop());
    context?.close();
    stream = null;
    context = null;
  }

  async function startCapture() {
    stopCapture();
    const videos = [...document.querySelectorAll('video')].filter((v) => !v.paused && v.readyState >= 2);
    const video = videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!video) {
      browser.runtime.sendMessage({ target: 'bg', type: 'status', state: 'error', text: ['status_play_first'] });
      return;
    }

    try {
      const capture = video.captureStream ?? video.mozCaptureStream;
      if (!capture) throw new Error(browser.i18n.getMessage('capture_unsupported'));
      stream = capture.call(video);
      if (!stream.getAudioTracks().length) throw new Error(browser.i18n.getMessage('capture_no_track'));
      context = new AudioContext({ sampleRate: 16000 });
      await context.resume();
      await context.audioWorklet.addModule(browser.runtime.getURL('worklet.js'));
      const node = new AudioWorkletNode(context, 'capture-processor');
      const mute = context.createGain();
      mute.gain.value = 0;
      context.createMediaStreamSource(stream).connect(node).connect(mute).connect(context.destination);
      node.port.onmessage = ({ data }) => browser.runtime.sendMessage({ target: 'offscreen', type: 'frame', audio: data });
      stream.getAudioTracks()[0].addEventListener('ended', () => stopCapture());
    } catch (error) {
      stopCapture();
      browser.runtime.sendMessage({ target: 'bg', type: 'status', state: 'error', text: ['status_capture_failed', error.message] });
    }
  }
}
