export class MicCapture {
 private stream?:MediaStream;
 private context?:AudioContext;
 private recorder?:MediaRecorder;
 private chunkTimer?:ReturnType<typeof setTimeout>;
 private meterTimer?:ReturnType<typeof setInterval>;
 private running=false;
 private energy=0;
 private pending=0;
 constructor(private chunkMs:number,private serverOffset:number,private status:(text:string)=>void){}
 async start(){if(this.running)return;this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});this.context=new AudioContext();await this.context.resume();const source=this.context.createMediaStreamSource(this.stream),analyser=this.context.createAnalyser();analyser.fftSize=1024;source.connect(analyser);const samples=new Float32Array(analyser.fftSize);this.meterTimer=setInterval(()=>{analyser.getFloatTimeDomainData(samples);this.energy=Math.max(this.energy,Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length))},100);this.running=true;this.status('Recording');this.next()}
 private next(){if(!this.running||!this.stream)return;this.energy=0;const start=Date.now()+this.serverOffset;const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(m=>MediaRecorder.isTypeSupported(m));const recorder=new MediaRecorder(this.stream,mime?{mimeType:mime}:undefined);this.recorder=recorder;const parts:Blob[]=[];recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};recorder.onstop=()=>{const end=Date.now()+this.serverOffset;const audible=this.energy>=.012;const blob=new Blob(parts,{type:recorder.mimeType});if(this.running)this.next();if(audible&&blob.size&&this.pending<8){this.pending++;const form=new FormData();form.append('audio',blob,recorder.mimeType.includes('mp4')?'chunk.mp4':'chunk.webm');form.append('started_at_ms',String(start));form.append('ended_at_ms',String(end));void fetch('/api/transcribe',{method:'POST',body:form}).then(async r=>{if(!r.ok){const e=await r.json();throw Error(e.error??'Transcription failed')}if(this.running)this.status('Recording')}).catch(e=>this.status(e.message)).finally(()=>this.pending--)}else if(this.running&&this.pending>=8)this.status('Transcription is busy; chunk skipped')};recorder.start();this.chunkTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},this.chunkMs)}
 stop(){this.running=false;clearTimeout(this.chunkTimer);clearInterval(this.meterTimer);if(this.recorder?.state==='recording')this.recorder.stop();this.stream?.getTracks().forEach(track=>track.stop());void this.context?.close();this.status('Mic stopped')}
}
