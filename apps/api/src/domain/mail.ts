import net from 'node:net';
import tls from 'node:tls';
import {once} from 'node:events';
import type {DomainOptions} from '@between/contracts/domain';
export interface MailTransport {sendCode(email:string,code:string):Promise<void>;}
class Replies {
  private buffer='';private bytes=0;private lines:string[]=[];private waiter?:{resolve:()=>void;reject:(error:Error)=>void};private failed?:Error;
  constructor(readonly socket:net.Socket){socket.setEncoding('utf8');socket.on('data',this.data);socket.on('error',this.error);socket.on('close',this.closed);}
  private data=(chunk:string|Buffer)=>{
    this.bytes+=Buffer.byteLength(chunk);if(this.bytes>65536){this.error(new Error('SMTP response limit'));this.socket.destroy();return;}
    this.buffer+=String(chunk);let end:number;
    while((end=this.buffer.indexOf('\r\n'))>=0){this.lines.push(this.buffer.slice(0,end));this.buffer=this.buffer.slice(end+2);}
    this.waiter?.resolve();this.waiter=undefined;
  };
  private error=(error:Error)=>{this.failed=error;this.waiter?.reject(error);this.waiter=undefined;};
  private closed=()=>this.error(new Error('SMTP disconnected'));
  detach(){this.socket.off('data',this.data);this.socket.off('error',this.error);this.socket.off('close',this.closed);}
  async read(){
    const response:string[]=[];
    for(;;){
      if(!this.lines.length){if(this.failed)throw this.failed;await new Promise<void>((resolve,reject)=>{this.waiter={resolve,reject};});continue;}
      const line=this.lines.shift()!;response.push(line);
      if(!/^\d{3}[- ]/.test(line))throw new Error('Malformed SMTP response');
      if(line[3]===' ')return {code:Number(line.slice(0,3)),lines:response};
    }
  }
  async command(command:string,expected:number[]){this.socket.write(`${command}\r\n`);const reply=await this.read();if(!expected.includes(reply.code))throw new Error('SMTP command failed');return reply;}
}
export function smtpTransport(config:DomainOptions['smtp']):MailTransport {
  if(!config.host||/[\r\n]/.test(config.host)||!Number.isInteger(config.port)||config.port<1||config.port>65535||!config.from||/[\r\n<>]/.test(config.from))throw new Error('Invalid SMTP configuration');
  if(!!config.user!==!!config.password)throw new Error('SMTP credentials must be paired');
  return {async sendCode(email,code){
    if(/[\r\n<>]/.test(email)||!/^\d{6}$/.test(code))throw new Error('Invalid mail input');
    let socket:net.Socket|tls.TLSSocket=config.port===465?tls.connect({host:config.host,port:config.port,servername:config.host,rejectUnauthorized:true}):net.connect({host:config.host,port:config.port});
    const abort=()=>socket.destroy(new Error('SMTP deadline'));
    const timer=setTimeout(abort,10000);let wire=new Replies(socket);
    try {
      if(config.port===465)await once(socket,'secureConnect');
      if((await wire.read()).code!==220)throw new Error('SMTP greeting failed');
      let greeting=await wire.command('EHLO between.local',[250]);
      if(!(socket instanceof tls.TLSSocket)){
        if(!greeting.lines.some(line=>/STARTTLS/i.test(line)))throw new Error('SMTP requires STARTTLS');
        await wire.command('STARTTLS',[220]);wire.detach();
        socket=tls.connect({socket,servername:config.host,rejectUnauthorized:true});wire=new Replies(socket);
        await once(socket,'secureConnect');greeting=await wire.command('EHLO between.local',[250]);
      }
      if(config.user){
        if(!greeting.lines.some(line=>/AUTH.*PLAIN/i.test(line)))throw new Error('SMTP AUTH PLAIN unavailable');
        await wire.command(`AUTH PLAIN ${Buffer.from(`\0${config.user}\0${config.password}`).toString('base64')}`,[235]);
      }
      await wire.command(`MAIL FROM:<${config.from}>`,[250]);await wire.command(`RCPT TO:<${email}>`,[250,251]);await wire.command('DATA',[354]);
      const body=[`From: ${config.from}`,`To: ${email}`,'Subject: Email verification code','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 7bit','',`Your verification code: ${code}`,'The code expires in 10 minutes. If you did not request it, ignore this email.',''].join('\r\n');
      await wire.command(`${body}\r\n.`,[250]);await wire.command('QUIT',[221]);
    }finally{clearTimeout(timer);wire.detach();socket.destroy();}
  }};
}
