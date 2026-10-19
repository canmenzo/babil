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
      browser.runtime.sendMessage({ target: 'bg', type: 'status', state: 'error', text: 'Play a video before starting captions.' });
      return;
    }

    try {
      const capture = video.captureStream ?? video.mozCaptureStream;
      if (!capture) throw new Error('This Firefox version cannot capture media from this page.');
      stream = capture.call(video);
      if (!stream.getAudioTracks().length) throw new Error('No audio track is available. DRM or a protected player can block capture.');
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
      browser.runtime.sendMessage({ target: 'bg', type: 'status', state: 'error', text: `Audio capture failed: ${error.message}` });
    }
  }
}
