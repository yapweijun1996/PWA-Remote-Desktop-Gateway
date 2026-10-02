package com.rdg;

import org.apache.guacamole.*;
import org.apache.guacamole.io.*;
import org.apache.guacamole.net.*;
import org.apache.guacamole.protocol.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.List;

/** Fixed server-owned VNC configuration, official Guacamole handshake and transport. */
class GuacdConnector {
    final Config config;
    GuacdConnector(Config config) {this.config=config;}
    GuacamoleTunnel open(Sessions.Desktop desktop) throws Exception {
        Socket raw=new Socket();
        desktop.pending(raw);
        try {
            raw.connect(new InetSocketAddress(config.guacdHost(),config.guacdPort()),3000);
            raw.setSoTimeout(10000);raw.setTcpNoDelay(true);
            GuacamoleSocket socket=new GuacamoleSocket() {
                final BoundedReader bounded=new BoundedReader(new InputStreamReader(raw.getInputStream(),StandardCharsets.UTF_8),8*1024*1024);
                final ReaderGuacamoleReader official=new ReaderGuacamoleReader(bounded);
                final GuacamoleReader reader=new GuacamoleReader() {
                    public boolean available() throws GuacamoleException{return official.available();}
                    public char[] read() throws GuacamoleException{try{return official.read();}finally{bounded.instructionConsumed();}}
                    public GuacamoleInstruction readInstruction() throws GuacamoleException{try{return official.readInstruction();}finally{bounded.instructionConsumed();}}
                };
                final GuacamoleWriter writer=new WriterGuacamoleWriter(new OutputStreamWriter(raw.getOutputStream(),StandardCharsets.UTF_8));
                public GuacamoleReader getReader(){return reader;}
                public GuacamoleWriter getWriter(){return writer;}
                public boolean isOpen(){return !raw.isClosed();}
                public void close() throws GuacamoleException {try{raw.close();}catch(IOException e){throw new GuacamoleConnectionClosedException("UPSTREAM_CLOSED");}}
            };
            GuacamoleConfiguration vnc=new GuacamoleConfiguration();vnc.setProtocol("vnc");
            vnc.setParameter("hostname",config.targetHost());vnc.setParameter("port",Integer.toString(config.targetPort()));
            vnc.setParameter("password",Config.secretValue(config.secret()));
            vnc.setParameter("read-only",desktop.mode.equals("view")?"true":"false");
            vnc.setParameter("disable-copy",desktop.clipboard?"false":"true");
            vnc.setParameter("disable-paste",desktop.clipboard?"false":"true");
            vnc.setParameter("clipboard-encoding","UTF-8");
            vnc.setParameter("enable-sftp","false");vnc.setParameter("enable-audio","false");
            GuacamoleClientInformation info=new GuacamoleClientInformation();
            info.setOptimalScreenWidth(1280);info.setOptimalScreenHeight(800);info.setOptimalResolution(96);
            info.getImageMimetypes().addAll(List.of("image/png","image/jpeg","image/webp"));
            return new SimpleGuacamoleTunnel(new ConfiguredGuacamoleSocket(socket,vnc,info));
        }catch(Exception e){raw.close();throw e;}
    }
}
