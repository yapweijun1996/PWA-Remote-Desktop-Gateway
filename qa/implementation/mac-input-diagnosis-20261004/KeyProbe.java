package com.rdg.qa;

import org.apache.guacamole.*;
import org.apache.guacamole.io.*;
import org.apache.guacamole.net.*;
import org.apache.guacamole.protocol.*;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Disposable: what the real guacd acknowledges and forwards when the gateway's clipboard stream is sent. No real desktop. */
public final class KeyProbe {
    static final String PASSWORD="fixture!";
    static final long T0=System.nanoTime();
    static long ms(){return (System.nanoTime()-T0)/1_000_000;}
    static final BlockingQueue<String> rfbLog=new LinkedBlockingQueue<>();
    static volatile boolean rfbReady;

    static void rfbServer() throws Exception {
        var listener=new ServerSocket(5900,1,InetAddress.getByName("127.0.0.1"));listener.setSoTimeout(15000);
        var thread=new Thread(()->{try(Socket c=listener.accept()){
            c.setTcpNoDelay(true);var in=new DataInputStream(c.getInputStream());var out=new DataOutputStream(c.getOutputStream());
            out.write("RFB 003.008\n".getBytes());out.flush();in.readNBytes(12);
            out.write(new byte[]{1,2});out.flush();in.readUnsignedByte();
            byte[] challenge=new byte[16];for(int i=0;i<16;i++)challenge[i]=(byte)(i*13+7);out.write(challenge);out.flush();
            byte[] key=PASSWORD.getBytes(StandardCharsets.US_ASCII).clone();for(int i=0;i<key.length;i++)key[i]=(byte)(Integer.reverse(Byte.toUnsignedInt(key[i]))>>>24);
            Cipher cipher=Cipher.getInstance("DES/ECB/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"DES"));
            in.readNBytes(16);out.writeInt(0);out.flush();in.readUnsignedByte();
            byte[] fmt=java.nio.ByteBuffer.allocate(16).put((byte)32).put((byte)24).put((byte)0).put((byte)1).putShort((short)255).putShort((short)255).putShort((short)255).put((byte)16).put((byte)8).put((byte)0).put(new byte[3]).array();
            out.writeShort(64);out.writeShort(48);out.write(fmt);out.writeInt(0);out.flush();rfbReady=true;
            while(true){int type=in.read();if(type<0)break;
                switch(type){
                    case 0->in.skipNBytes(19);
                    case 2->{in.readUnsignedByte();int n=in.readUnsignedShort();in.skipNBytes(4L*n);}
                    case 3->{in.skipNBytes(9);out.writeByte(0);out.writeByte(0);out.writeShort(0);out.flush();}   // empty FramebufferUpdate
                    case 4->{int down=in.readUnsignedByte();in.skipNBytes(2);int sym=in.readInt();rfbLog.add(String.format("[%5d ms] RFB KeyEvent %s 0x%04x",ms(),down==1?"down":"up  ",sym));}
                    case 5->in.skipNBytes(5);
                    case 6->{in.skipNBytes(3);int len=in.readInt();byte[] text=in.readNBytes(len);
                        rfbLog.add(String.format("[%5d ms] RFB server got ClientCutText: %d bytes, hex=%s, as UTF-8=\"%s\", as Latin-1=\"%s\"",ms(),len,hex(text,24),new String(text,StandardCharsets.UTF_8).replace("\n","\\n"),new String(text,StandardCharsets.ISO_8859_1).replace("\n","\\n")));}
                    default->{rfbLog.add("unexpected RFB type "+type);return;}
                }}
        }catch(Exception e){rfbLog.add("rfb server ended: "+e);}},"rfb");thread.setDaemon(true);thread.start();
    }
    static String hex(byte[] b,int max){var s=new StringBuilder();for(int i=0;i<Math.min(b.length,max);i++)s.append(String.format("%02x",b[i]));return s+(b.length>max?"…":"");}

    public static void main(String[] args) throws Exception {
        String encoding=args.length>0?args[0]:"UTF-8";
        java.util.logging.LogManager.getLogManager().reset();
        rfbServer();
        Socket raw=new Socket();raw.connect(new InetSocketAddress("127.0.0.1",4822),3000);raw.setSoTimeout(15000);raw.setTcpNoDelay(true);
        GuacamoleSocket transport=new GuacamoleSocket(){
            final GuacamoleReader r=new ReaderGuacamoleReader(new InputStreamReader(raw.getInputStream(),StandardCharsets.UTF_8));
            final GuacamoleWriter w=new WriterGuacamoleWriter(new OutputStreamWriter(raw.getOutputStream(),StandardCharsets.UTF_8));
            public GuacamoleReader getReader(){return r;}public GuacamoleWriter getWriter(){return w;}public boolean isOpen(){return !raw.isClosed();}
            public void close()throws GuacamoleException{try{raw.close();}catch(IOException e){throw new GuacamoleConnectionClosedException("x");}}};
        var cfg=new GuacamoleConfiguration();cfg.setProtocol("vnc");
        // Same parameters as GuacdConnector for a control session with clipboard consent, Balanced preset.
        cfg.setParameter("hostname","127.0.0.1");cfg.setParameter("port","5900");cfg.setParameter("password",PASSWORD);
        cfg.setParameter("read-only","false");cfg.setParameter("disable-copy","false");cfg.setParameter("disable-paste","false");
        cfg.setParameter("clipboard-encoding",encoding);cfg.setParameter("enable-sftp","false");cfg.setParameter("enable-audio","false");
        var info=new GuacamoleClientInformation();info.setOptimalScreenWidth(64);info.setOptimalScreenHeight(48);info.setOptimalResolution(96);
        info.getImageMimetypes().addAll(List.of("image/png","image/jpeg","image/webp"));
        var socket=new ConfiguredGuacamoleSocket(transport,cfg,info);var reader=socket.getReader();var writer=socket.getWriter();
        var gd=new LinkedBlockingQueue<String>();
        var pump=new Thread(()->{try{GuacamoleInstruction i;while((i=reader.readInstruction())!=null){
            if(i.getOpcode().equals("ack")||i.getOpcode().equals("error")||i.getOpcode().equals("disconnect"))gd.add(String.format("[%5d ms] guacd -> %s %s",ms(),i.getOpcode(),i.getArgs()));
            else if(i.getOpcode().equals("sync"))writer.writeInstruction(new GuacamoleInstruction("sync",i.getArgs().get(0)));
        }}catch(Exception e){gd.add("guacd reader ended: "+e);}},"gd");pump.setDaemon(true);pump.start();
        for(int n=0;n<40&&!rfbReady;n++)Thread.sleep(100);Thread.sleep(500);
        System.out.println("== key forwarding through official guacd ==");
        String[][] seqs={{"Cmd+V as Super_L","65515","118"},{"Cmd+V as Meta_L","65511","118"},{"Cmd+V as Alt_L","65513","118"},{"Cmd+V as Hyper_L","65517","118"},{"Cmd+Space as Super_L","65515","32"},{"Shift+a","65505","97"}};
        for(var s:seqs){
            rfbLog.clear();System.out.println("-- "+s[0]);
            writer.writeInstruction(new GuacamoleInstruction("key",s[1],"1"));
            writer.writeInstruction(new GuacamoleInstruction("key",s[2],"1"));
            writer.writeInstruction(new GuacamoleInstruction("key",s[2],"0"));
            writer.writeInstruction(new GuacamoleInstruction("key",s[1],"0"));
            long end=System.currentTimeMillis()+700;
            while(System.currentTimeMillis()<end){String r=rfbLog.poll(50,TimeUnit.MILLISECONDS);if(r!=null)System.out.println("   "+r);}
            String l;while((l=gd.poll())!=null)System.out.println("   "+l);
        }
        raw.close();
    }
}
