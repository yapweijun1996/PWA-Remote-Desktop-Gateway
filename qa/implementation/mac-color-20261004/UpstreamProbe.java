package com.rdg;
import org.apache.guacamole.net.*;
import org.apache.guacamole.protocol.*;
import java.util.List;
public final class UpstreamProbe {
 public static void main(String[] args) {
  Thread deadline=new Thread(()->{try{Thread.sleep(10000);System.out.println("PROBE_DEADLINE");System.exit(2);}catch(InterruptedException ignored){} });deadline.setDaemon(true);deadline.start();
  try {
   Config c=Config.load(System.getenv());GuacamoleConfiguration v=new GuacamoleConfiguration();v.setProtocol("vnc");
   if(args[0].equals("candidate16")){v.setParameter("color-depth","16");v.setParameter("force-lossless","true");}else DisplayQuality.parse(args[0]).apply(v);v.setParameter("hostname",c.targetHost());v.setParameter("port",Integer.toString(c.targetPort()));
   v.setParameter("password",c.desktopCredential());v.setParameter("read-only","true");v.setParameter("disable-copy","true");v.setParameter("disable-paste","true");v.setParameter("clipboard-encoding","UTF-8");v.setParameter("enable-sftp","false");v.setParameter("enable-audio","false");
   var info=new GuacamoleClientInformation();info.setOptimalScreenWidth(1280);info.setOptimalScreenHeight(800);info.setOptimalResolution(96);info.getImageMimetypes().addAll(List.of("image/png","image/jpeg","image/webp"));
   var raw=new InetGuacamoleSocket(c.guacdHost(),c.guacdPort());
   try {
    var socket=new ConfiguredGuacamoleSocket(raw,v,info);v.unsetParameter("password");
    long until=System.nanoTime()+8_000_000_000L;int syncs=0,images=0;boolean size=false;
    var reader=socket.getReader();var writer=socket.getWriter();
    while(System.nanoTime()<until) {
     var i=reader.readInstruction();if(i==null){System.out.println("UPSTREAM_EOF");return;}
     String op=i.getOpcode();
     if(op.equals("error")){String code=i.getArgs().size()>1?i.getArgs().get(1):"";System.out.println("UPSTREAM_ERROR_CODE="+(code.matches("[0-9]{1,5}")?code:"UNKNOWN"));return;}
     if(op.equals("disconnect")){System.out.println("UPSTREAM_DISCONNECT");return;}
     if(op.equals("size"))size=true;
     if(op.equals("img")||op.equals("png")||op.equals("jpeg"))images++;
     if(op.equals("sync")){syncs++;writer.writeInstruction(new GuacamoleInstruction("sync",i.getArgs().get(0)));}
    }
    System.out.println("VIEW_PROBE_COMPLETE syncs="+syncs+" imageInstructions="+images+" hasSize="+size);
   } finally {v.unsetParameter("password");raw.close();}
  } catch(Exception e){System.out.println("UPSTREAM_PROBE_FAILED "+e.getClass().getSimpleName());}
 }
}
