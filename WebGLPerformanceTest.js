function WebGLPerformanceTest(manifest) {
  if (manifest.title === undefined) manifest.title = "Untitled";
  if (manifest.frameCallback === undefined) manifest.frameCallback = function() {};
  if (manifest.contextCreationFlags === undefined) manifest.contextCreationFlags = {};
  if (manifest.frameMethod === undefined) manifest.frameMethod = "requestAnimationFrame";
  if (manifest === undefined) manifest = {};
  if (manifest.width === undefined)
    manifest.width = (manifest.frameMethod == "requestAnimationFrame") ? 1024 : 1;
  if (manifest.height === undefined)
    manifest.height = (manifest.frameMethod == "requestAnimationFrame") ? 1024 : 1;
  if (manifest.repeat === undefined) manifest.repeat = 1;
  if (manifest.accountForGLFinishTime === undefined) manifest.accountForGLFinishTime = true;

  this.title = document.createElement("div");
  document.body.appendChild(this.title);
  this.results = document.createElement("div");
  document.body.appendChild(this.results);
  this.canvas = document.createElement("canvas", manifest);
  document.body.appendChild(this.canvas);

  this.canvas.width = manifest.width;
  this.canvas.height = manifest.height;
  this.userFrameCallback = manifest.frameCallback;
  this.contextCreationFlags = manifest.contextCreationFlags;
  this.repeat = manifest.repeat;
  this.frameMethod = manifest.frameMethod;
  this.accountForGLFinishTime = manifest.accountForGLFinishTime;
  this.requiredExtensions = manifest.requiredExtensions;

  try {
    this.gl = this.canvas.getContext("experimental-webgl", this.contextCreationFlags);
  } catch(e) {
    this.gl = null;
  }

  this.frame = 0;
  this.timings = [];

  this.description = manifest.title +
    (this.contextCreationFlags.preserveDrawingBuffer ? ", with preserveDrawingBuffer" : "") +
    (this.repeat > 1 ? ", repeated " + this.repeat + "&times;" : "");
  if (this.frameMethod == "requestAnimationFrame")
    this.description += ", size " + this.canvas.width + "&times;" + this.canvas.height;

  this.title.innerHTML = "<h3>" + this.description + "</h3>";

  if (this.requiredExtensions) {
    for (var i = 0; i < this.requiredExtensions.length; i++) {
      if (!this.gl.getExtension(this.requiredExtensions[i])) {
        this.unsupportedRequiredExtension = this.requiredExtensions[i];
        this.finish();
        return;
      }
    }
  }

  window.requestAnimationFrame = 
    window.requestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    window.oRequestAnimationFrame ||
    window.msRequestAnimationFrame;

  window.setTimeoutZero = function(callback) {
    window.setTimeout(callback, 0);
  }

  if (this.frameMethod == "requestAnimationFrame") {
    window.requestFrameFunc = window.requestAnimationFrame;
    this.minimumLegalFrameDuration = 16;
  } else if (this.frameMethod == "setTimeoutZero") {
    window.requestFrameFunc = window.setTimeoutZero;
    this.minimumLegalFrameDuration = 0;
  } else throw "unknown frameMethod: " + this.frameMethod;

  this.masterFrameCallbackBoundToThis = this.masterFrameCallback.bind(this);
}

WebGLPerformanceTest.prototype.registerFrameCallback = function() {
  window.requestFrameFunc(this.masterFrameCallbackBoundToThis);
}

WebGLPerformanceTest.prototype.masterFrameCallback = function(time)
{
  var timeAlreadyPassedToUs = !!time;

  // before the frame, if not using requestAnimationFrame, we have to get a timestamp
  if (!timeAlreadyPassedToUs) {
    // always finish before starting the benchmark
    this.gl.finish();
    time = new Date().getTime();
  }

  // the actual frame rendering
  for (var i = 0; i < this.repeat; i++)
    this.userFrameCallback(this);

  // after the frame, if not using requestAnimationFrame, we have to get a timestamp
  if (!timeAlreadyPassedToUs) {
    if (this.accountForGLFinishTime)
      this.gl.finish();
    this.timings.push(new Date().getTime() - time);
    if (!this.startTime)
      this.startTime = time;
  } else {
    // we rely solely on the |time| values passed to this function.
    if (this.lastTime) {
      // not the first frame
      var deltaTime = time - this.lastTime;
      if (this.shouldRecordPreviousFrame(deltaTime))
        this.timings.push(deltaTime);
    } else {
      // this is the first frame
      this.startTime = time;
    }
  }

  if (this.hasRecordedEnoughFrames(time)) {
    this.finish(time);
    return;
  }

  this.lastTime = time;
  this.frame++;

  this.registerFrameCallback();
}

WebGLPerformanceTest.prototype.shouldRecordPreviousFrame = function(deltaTime) {
  // with requestAnimationFrame,
  // if deltaTime < 16 ms, all we have is a requestAnimationFrame bug as in
  // https://bugzilla.mozilla.org/show_bug.cgi?id=731974
  return deltaTime >= this.minimumLegalFrameDuration;
}

WebGLPerformanceTest.prototype.hasRecordedEnoughFrames = function(time) {
  // stop when we have recorded at least 10 frames and run for at least 300 ms
  return this.timings.length > 10 && 
         time - this.startTime > 300;
}

WebGLPerformanceTest.prototype.finish = function(time) {
  if (this.unsupportedRequiredExtension) {
    this.results.innerHTML = "Requires unsupported extension: " + this.unsupportedRequiredExtension;
    parent.postMessage({ testDescription : this.description, skip : true }, "*");
    return;
  }
  if (this.customError) {
    this.results.innerHTML = "Error: " + this.customError;
    parent.postMessage({ testDescription : this.description, error : true }, "*");
    return;
  }
  if (this.gl.getError()) {
    this.results.innerHTML = "A WebGL error occurred!";
    parent.postMessage({ testDescription : this.description, error : true }, "*");
    return;
  }
  this.timings.sort(compareNumbers);
  var medianIndex = Math.floor(this.timings.length/2);
  var median = this.timings[medianIndex];
  var sum = 0;
  for(var i = 0; i < this.timings.length; i++) sum += this.timings[i];
  var average = sum / this.timings.length;
  var sumDiffSquares = 0;
  for(var i = 0; i < this.timings.length; i++) {
    var diff = this.timings[i] - average;
    sumDiffSquares += diff * diff;
  }
  var variance = sumDiffSquares / this.timings.length;
  var stdDev = Math.sqrt(variance);

  this.results.innerHTML =
    "<b>median: " + median + " ms</b><br>" +
    "average: " + Math.round(average) + " ms<br>" +
    "standard deviation: " + Math.round(stdDev) + " ms " +
    "(" + Math.round(100*stdDev/median) + "% of median)<br>" +
    "sorted timings: " + this.timings.slice(0, medianIndex).join(", ") +
    ", <b>" + median + "</b>, " + this.timings.slice(medianIndex+1, this.timings.length).join(", ");

  parent.postMessage({ testDescription : this.description, testResult : median }, "*");
}

function compareNumbers(a,b)
{
  return a - b;
}

WebGLPerformanceTest.prototype.run = function() {
  if (this.unsupportedRequiredExtension)
    return;
  if (this.gl) {
    this.results.innerHTML = "running...";
    this.registerFrameCallback();
  } else {
    this.results.innerHTML = "Could not get a WebGL context";
  }
}

WebGLPerformanceTest.prototype.error = function(e) {
  this.customError = e;
  this.finish();
  throw "error: " + e;
}

function test(manifest) {
  new WebGLPerformanceTest(manifest).run();
}