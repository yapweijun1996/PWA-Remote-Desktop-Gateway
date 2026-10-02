package com.rdg;

import org.apache.catalina.startup.Tomcat;
import org.apache.catalina.Context;
import org.apache.tomcat.util.descriptor.web.*;
import org.apache.tomcat.websocket.server.*;
import javax.servlet.*;
import javax.websocket.*;
import javax.websocket.server.*;
import java.nio.file.*;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.*;

public final class Main {
    static final class Runtime implements AutoCloseable {
        final Tomcat tomcat;final Sessions sessions;final Audit audit;final ScheduledExecutorService timer;
        Runtime(Config c,AccessVerifier verifier,GuacdConnector connector) throws Exception {this(c,verifier,connector,Clock.systemUTC(),System::nanoTime);}
        Runtime(Config c,AccessVerifier verifier,GuacdConnector connector,Clock clock,java.util.function.LongSupplier ticker) throws Exception {
            audit=new Audit(c.stateDir(),clock,c.nodeId());sessions=new Sessions(c,clock,ticker,audit);
            tomcat=new Tomcat();tomcat.setBaseDir(c.stateDir().resolve("runtime").toString());tomcat.setPort(c.listenPort());
            tomcat.getConnector().setProperty("address",c.listenAddress());tomcat.getConnector().setProperty("maxThreads","24");
            tomcat.getConnector().setProperty("maxConnections","64");tomcat.getConnector().setProperty("acceptCount","16");
            tomcat.getConnector().setProperty("connectionTimeout","10000");tomcat.getConnector().setProperty("maxHttpHeaderSize","32768");
            tomcat.getConnector().setProperty("maxPostSize","4096");tomcat.getConnector().setProperty("server","RDG");
            Context context=tomcat.addContext("",c.webDir().toAbsolutePath().toString());
            context.setSessionTimeout(0);context.setUseHttpOnly(true);
            FilterDef f=new FilterDef();f.setFilterName("security");f.setFilter(new GatewayFilter(c,verifier,sessions));context.addFilterDef(f);
            FilterMap fm=new FilterMap();fm.setFilterName("security");fm.addURLPattern("/*");context.addFilterMapBefore(fm);
            Tomcat.addServlet(context,"api",new ApiServlet(c,sessions));context.addServletMappingDecoded("/api/*","api");
            Tomcat.addServlet(context,"static",new StaticServlet(c.webDir()));context.addServletMappingDecoded("/","static");
            context.addServletContainerInitializer(new WsSci(),null);
            context.addServletContainerInitializer((classes,servlet)-> {
                ServerContainer container=(ServerContainer)servlet.getAttribute("javax.websocket.server.ServerContainer");
                container.setDefaultMaxTextMessageBufferSize(49152);
                container.setDefaultMaxSessionIdleTimeout(30000);
                container.setAsyncSendTimeout(5000);
                try {
                    container.addEndpoint(ServerEndpointConfig.Builder.create(DesktopEndpoint.class,"/ws/sessions/{intentId}")
                        .subprotocols(List.of("guacamole")).configurator(new ServerEndpointConfig.Configurator() {
                            @Override public boolean checkOrigin(String origin){return c.origin().equals(origin);}
                            @Override public <T> T getEndpointInstance(Class<T> clazz){return clazz.cast(new DesktopEndpoint(sessions,connector));}
                        }).build());
                }catch(DeploymentException e){throw new ServletException("WebSocket initialization failed");}
            },null);
            tomcat.start();
            timer=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"rdg-expiry");t.setDaemon(true);return t;});
            timer.scheduleAtFixedRate(sessions::tick,250,250,TimeUnit.MILLISECONDS);
        }
        int port(){return tomcat.getConnector().getLocalPort();}
        public void close() throws Exception{timer.shutdownNow();sessions.close();tomcat.stop();tomcat.destroy();audit.close();}
    }
    public static void main(String[] args) {
        // Third-party log messages may include protocol/upstream details. Use only bounded app audit.
        java.util.logging.LogManager.getLogManager().reset();
        if(args.length==1 && args[0].equals("--health")) {
            try {
                int port=Integer.parseInt(System.getenv().getOrDefault("RDG_LISTEN_PORT","8080"));
                var client=java.net.http.HttpClient.newBuilder().connectTimeout(java.time.Duration.ofSeconds(2)).build();
                var response=client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+port+"/health")).timeout(java.time.Duration.ofSeconds(2)).GET().build(),java.net.http.HttpResponse.BodyHandlers.discarding());
                System.exit(response.statusCode()==200?0:1);
            }catch(Exception e){System.exit(1);}return;
        }
        try {
            Config config=Config.load(System.getenv());
            Runtime runtime=new Runtime(config,new AccessVerifier(config,Clock.systemUTC()),new GuacdConnector(config));
            java.lang.Runtime.getRuntime().addShutdownHook(new Thread(()->{try{runtime.close();}catch(Exception ignored){}}));
            System.out.println("RDG gateway ready; public/real-target acceptance requires operator verification.");
            runtime.tomcat.getServer().await();
        }catch(Exception e){System.err.println("RDG startup refused: CONFIGURATION_OR_RUNTIME_INVALID");System.exit(1);}
    }
}
