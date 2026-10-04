package com.rdg.qa;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.guacamole.*;
import org.apache.guacamole.io.*;
import org.apache.guacamole.net.*;
import org.apache.guacamole.protocol.*;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.io.*;
import java.net.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.zip.Deflater;

/** Test-only synthetic RFB peer. Never connects to a real host, logs pixels or runs the gateway. */
public final class BandwidthBenchmark {
    private static final int WIDTH=640, HEIGHT=360, FRAMES=12, REPEATS=3;
    private static final String FIXTURE_PASSWORD="fixture!";
    private static volatile String peerFailure="NONE";
    private static Map<String,Map<String,String>> PROFILES;

    /** Read the same compiled production owner of preset parameters, rather than duplicating them. */
    private static Map<String,Map<String,String>> productionProfiles()throws Exception {
        Class<?> quality=Class.forName("com.rdg.DisplayQuality");
        var parse=quality.getDeclaredMethod("parse",String.class);parse.setAccessible(true);
        var apply=quality.getDeclaredMethod("apply",GuacamoleConfiguration.class);apply.setAccessible(true);
        var profiles=new LinkedHashMap<String,Map<String,String>>();
        for(String id:List.of("low","balanced","clear")) {
            var parameters=new GuacamoleConfiguration();apply.invoke(parse.invoke(null,id),parameters);
            profiles.put(id,Map.copyOf(parameters.getParameters()));
        }
        return profiles;
    }

    private static void require(boolean condition,String category) {
        if(!condition)throw new IllegalStateException(category);
    }
    private static final class CountedInput extends FilterInputStream {
        final AtomicLong count=new AtomicLong();
        CountedInput(InputStream stream){super(stream);}
        public int read() throws IOException {int value=in.read();if(value>=0)count.incrementAndGet();return value;}
        public int read(byte[] bytes,int offset,int length) throws IOException {
            int received=in.read(bytes,offset,length);if(received>0)count.addAndGet(received);return received;
        }
    }
    private static final class CountedOutput extends FilterOutputStream {
        final AtomicLong count=new AtomicLong();
        CountedOutput(OutputStream stream){super(stream);}
        public void write(int value)throws IOException{out.write(value);count.incrementAndGet();}
        public void write(byte[] bytes,int offset,int length)throws IOException {
            out.write(bytes,offset,length);count.addAndGet(length);
        }
    }
    private record PixelFormat(int bits,int depth,boolean bigEndian,int redMax,int greenMax,int blueMax,
                               int redShift,int greenShift,int blueShift) {
        static PixelFormat parse(byte[] bytes) {
            ByteBuffer buffer=ByteBuffer.wrap(bytes);
            int bits=Byte.toUnsignedInt(buffer.get()),depth=Byte.toUnsignedInt(buffer.get());
            boolean endian=buffer.get()!=0;require(buffer.get()==1,"TRUE_COLOUR_REQUIRED");
            return new PixelFormat(bits,depth,endian,Short.toUnsignedInt(buffer.getShort()),
                Short.toUnsignedInt(buffer.getShort()),Short.toUnsignedInt(buffer.getShort()),
                Byte.toUnsignedInt(buffer.get()),Byte.toUnsignedInt(buffer.get()),Byte.toUnsignedInt(buffer.get()));
        }
    }

    private static final class SyntheticVnc implements AutoCloseable {
        final ServerSocket listener;
        final CompletableFuture<Void> finished=new CompletableFuture<>();
        final String capability;
        final Thread thread;
        volatile Socket socket;
        volatile PixelFormat format;
        volatile List<Integer> requestedEncodings=List.of();
        volatile Integer compression,quality;
        volatile String chosenEncoding;
        volatile long bytesSent,bytesReceived,pixelPayloadBytes;
        volatile int framesSent,pointersReceived;
        SyntheticVnc(String capability)throws IOException {
            this.capability=capability;
            peerFailure="NONE";
            listener=new ServerSocket(5900,1,InetAddress.getByName("127.0.0.1"));listener.setSoTimeout(8000);
            thread=new Thread(()->{try{serve();finished.complete(null);}catch(Throwable failure){
                if(listener.isClosed()||(socket!=null&&socket.isClosed()))finished.complete(null);
                else {peerFailure=failure.getClass().getSimpleName();finished.completeExceptionally(new IllegalStateException("SYNTHETIC_RFB_FAILED"));}
            }},"rdg-bandwidth-synthetic-rfb");thread.setDaemon(true);thread.start();
        }
        private void serve()throws Exception {
            try(Socket connection=listener.accept()) {
                socket=connection;connection.setTcpNoDelay(true);connection.setSoTimeout(8000);
                var countedIn=new CountedInput(connection.getInputStream());
                var countedOut=new CountedOutput(connection.getOutputStream());
                var input=new DataInputStream(countedIn);var output=new DataOutputStream(countedOut);
                try {
                    output.write("RFB 003.008\n".getBytes(StandardCharsets.US_ASCII));output.flush();
                    require(Arrays.equals(input.readNBytes(12),"RFB 003.008\n".getBytes(StandardCharsets.US_ASCII)),"RFB_VERSION_MISMATCH");
                    output.write(new byte[]{1,2});output.flush();require(input.readUnsignedByte()==2,"VNC_PASSWORD_POLICY_MISSING");
                    byte[] challenge=new byte[16];for(int index=0;index<challenge.length;index++)challenge[index]=(byte)(index*13+7);
                    output.write(challenge);output.flush();
                    byte[] key=FIXTURE_PASSWORD.getBytes(StandardCharsets.US_ASCII).clone();
                    for(int index=0;index<key.length;index++)key[index]=(byte)(Integer.reverse(Byte.toUnsignedInt(key[index]))>>>24);
                    Cipher cipher=Cipher.getInstance("DES/ECB/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"DES"));
                    require(Arrays.equals(input.readNBytes(16),cipher.doFinal(challenge)),"FIXTURE_AUTH_FAILED");
                    Arrays.fill(key,(byte)0);Arrays.fill(challenge,(byte)0);
                    output.writeInt(0);output.flush();require(input.readUnsignedByte()<=1,"CLIENT_INIT_INVALID");
                    byte[] initialFormat=ByteBuffer.allocate(16).put((byte)32).put((byte)24).put((byte)0).put((byte)1)
                        .putShort((short)255).putShort((short)255).putShort((short)255)
                        .put((byte)16).put((byte)8).put((byte)0).put(new byte[3]).array();
                    format=PixelFormat.parse(initialFormat);
                    output.writeShort(WIDTH);output.writeShort(HEIGHT);output.write(initialFormat);output.writeInt(0);output.flush();
                    boolean requested=false;int pending=0;
                    Deflater zlib=null;
                    try {
                        while(true) {
                            int type=input.read();if(type<0)break;
                            switch(type) {
                                case 0 -> {input.skipNBytes(3);format=PixelFormat.parse(input.readNBytes(16));
                                    require(Set.of(8,16,32).contains(format.bits()),"PIXEL_FORMAT_UNSUPPORTED");}
                                case 2 -> {
                                    input.readUnsignedByte();int count=input.readUnsignedShort();require(count<=256,"ENCODINGS_UNBOUNDED");
                                    var encodings=new ArrayList<Integer>();for(int index=0;index<count;index++)encodings.add(input.readInt());
                                    require(!encodings.contains(7),"UNEXPECTED_TIGHT_ADVERTISEMENT");
                                    requestedEncodings=List.copyOf(encodings);
                                    for(int encoding:encodings) {
                                        if(encoding>=-256&&encoding<=-247)compression=encoding+256;
                                        if(encoding>=-32&&encoding<=-23)quality=encoding+32;
                                    }
                                    int chosen=0;
                                    if(capability.equals("ZLIB_RAW"))for(int encoding:encodings)if(encoding==6||encoding==0){chosen=encoding;break;}
                                    chosenEncoding=chosen==6?"ZLIB":"RAW";
                                }
                                case 3 -> {input.skipNBytes(9);requested=true;}
                                case 4 -> {input.skipNBytes(7);throw new IllegalStateException("KEY_INPUT_FORBIDDEN");}
                                case 5 -> {input.skipNBytes(5);pointersReceived++;pending=pointersReceived;
                                    require(pending<=FRAMES,"EXCESSIVE_SYNTHETIC_POINTERS");}
                                case 6 -> {input.skipNBytes(3);int count=input.readInt();require(count==0,"CLIPBOARD_FORBIDDEN");}
                                default -> throw new IllegalStateException("SYNTHETIC_CLIENT_MESSAGE_UNSUPPORTED");
                            }
                            if(requested&&pending>=0) {
                                require(chosenEncoding!=null,"ENCODINGS_NOT_NEGOTIATED");
                                if(chosenEncoding.equals("ZLIB")&&zlib==null)zlib=new Deflater(compression==null?6:compression);
                                byte[] payload=payload(pending,format,chosenEncoding,zlib);
                                output.writeByte(0);output.writeByte(0);output.writeShort(1);
                                output.writeShort(0);output.writeShort(0);output.writeShort(WIDTH);output.writeShort(HEIGHT);
                                output.writeInt(chosenEncoding.equals("ZLIB")?6:0);
                                if(chosenEncoding.equals("ZLIB"))output.writeInt(payload.length);
                                output.write(payload);output.flush();pixelPayloadBytes+=payload.length;framesSent++;
                                requested=false;pending=-1;
                            }
                        }
                    }finally{if(zlib!=null)zlib.end();}
                }finally{bytesSent=countedOut.count.get();bytesReceived=countedIn.count.get();}
            }
        }
        public void close()throws Exception {
            listener.close();if(socket!=null)socket.close();thread.join(1000);
        }
    }

    /** A fixed deterministic animated pattern; no screenshot or private content is accepted. */
    private static int rgb(int x,int y,int frame) {
        int noise=((x*1973)^(y*9277)^(frame*26699));noise=(noise*(noise^0x45d9f3b))&31;
        int red=(x*255/WIDTH+frame*13+noise)&255;
        int green=(y*255/HEIGHT+frame*7+noise)&255;
        int blue=((x+y)*127/(WIDTH+HEIGHT)+frame*17+noise)&255;
        return(red<<16)|(green<<8)|blue;
    }
    private static byte[] payload(int frame,PixelFormat format,String encoding,Deflater zlib)throws IOException {
        var raw=new ByteArrayOutputStream(WIDTH*HEIGHT*format.bits()/8);
        for(int y=0;y<HEIGHT;y++)for(int x=0;x<WIDTH;x++) {
            int rgb=rgb(x,y,frame);
            int value=(((rgb>>>16)&255)*format.redMax()/255<<format.redShift())
                |(((rgb>>>8)&255)*format.greenMax()/255<<format.greenShift())
                |((rgb&255)*format.blueMax()/255<<format.blueShift());
            for(int byteIndex=0;byteIndex<format.bits()/8;byteIndex++)raw.write(value>>>
                (8*(format.bigEndian()?format.bits()/8-1-byteIndex:byteIndex)));
        }
        byte[] pixels=raw.toByteArray();if(encoding.equals("RAW"))return pixels;
        zlib.setInput(pixels);var compressed=new ByteArrayOutputStream();byte[] buffer=new byte[65536];
        while(true){int count=zlib.deflate(buffer,0,buffer.length,Deflater.SYNC_FLUSH);compressed.write(buffer,0,count);
            if(count<buffer.length&&zlib.needsInput())break;}
        return compressed.toByteArray();
    }

    private static final class ProtocolProbe implements AutoCloseable {
        final Socket raw=new Socket();final CountedInput input;final CountedOutput output;
        final GuacamoleSocket configured;
        final GuacamoleReader reader;final GuacamoleWriter writer;
        final Set<String> imageStreams=new HashSet<>();final Map<String,Integer> imageTypes=new TreeMap<>();
        long decodedImageBytes,base64ImageBytes;
        ProtocolProbe(String profile)throws Exception {
            raw.connect(new InetSocketAddress("127.0.0.1",4822),1000);raw.setSoTimeout(8000);raw.setTcpNoDelay(true);
            input=new CountedInput(raw.getInputStream());output=new CountedOutput(raw.getOutputStream());
            GuacamoleSocket transport=new GuacamoleSocket() {
                final GuacamoleReader reader=new ReaderGuacamoleReader(new InputStreamReader(input,StandardCharsets.UTF_8));
                final GuacamoleWriter writer=new WriterGuacamoleWriter(new OutputStreamWriter(output,StandardCharsets.UTF_8));
                public GuacamoleReader getReader(){return reader;}public GuacamoleWriter getWriter(){return writer;}
                public boolean isOpen(){return !raw.isClosed();}
                public void close()throws GuacamoleException{try{raw.close();}catch(IOException ignored){throw new GuacamoleConnectionClosedException("FIXTURE_CLOSED");}}
            };
            var parameters=new GuacamoleConfiguration();parameters.setProtocol("vnc");
            PROFILES.get(profile).forEach(parameters::setParameter);
            parameters.setParameter("hostname","127.0.0.1");parameters.setParameter("port","5900");
            parameters.setParameter("password",FIXTURE_PASSWORD);parameters.setParameter("read-only","false");
            parameters.setParameter("disable-copy","true");parameters.setParameter("disable-paste","true");
            parameters.setParameter("enable-sftp","false");parameters.setParameter("enable-audio","false");
            var info=new GuacamoleClientInformation();info.setOptimalScreenWidth(WIDTH);info.setOptimalScreenHeight(HEIGHT);info.setOptimalResolution(96);
            info.getImageMimetypes().addAll(List.of("image/png","image/jpeg","image/webp"));
            try{configured=new ConfiguredGuacamoleSocket(transport,parameters,info);}finally{parameters.unsetParameter("password");}
            reader=configured.getReader();writer=configured.getWriter();
        }
        void readFrame()throws Exception {
            boolean surfaceChanged=false;int instructionCount=0;
            while(true) {
                GuacamoleInstruction instruction=reader.readInstruction();require(instruction!=null,"GUACD_EOF");
                require(++instructionCount<8192,"GUACD_INSTRUCTIONS_UNBOUNDED");
                var args=instruction.getArgs();switch(instruction.getOpcode()) {
                    case "error","disconnect" -> throw new IllegalStateException("GUACD_TARGET_FAILED");
                    case "img" -> {
                        imageStreams.add(args.get(0));imageTypes.merge(args.get(3),1,Integer::sum);
                        if(args.get(2).equals("0"))surfaceChanged=true;
                    }
                    case "blob" -> {if(imageStreams.contains(args.get(0))) {
                        base64ImageBytes+=args.get(1).length();decodedImageBytes+=Base64.getDecoder().decode(args.get(1)).length;
                        writer.writeInstruction(new GuacamoleInstruction("ack",args.get(0),"OK","0"));
                    }}
                    case "end" -> imageStreams.remove(args.get(0));
                    case "sync" -> {writer.writeInstruction(new GuacamoleInstruction("sync",args.get(0)));if(surfaceChanged)return;}
                    default -> {}
                }
            }
        }
        public void close()throws Exception {
            if(configured.isOpen())try{writer.writeInstruction(new GuacamoleInstruction("disconnect"));}catch(GuacamoleException ignored){}
            configured.close();
        }
    }
    private static Map<String,Object> run(String profile,String capability,int repeat)throws Exception {
        long started=System.nanoTime();
        String stage="CONNECT";
        try(var fixture=new SyntheticVnc(capability);var probe=new ProtocolProbe(profile)) {
            long handshakeMs=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started);
            stage="INITIAL_FRAME";
            probe.readFrame();long firstFrameMs=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started);
            long wireStart=probe.input.count.get(),uploadStart=probe.output.count.get();
            long imagesStart=probe.decodedImageBytes,base64Start=probe.base64ImageBytes;
            var timings=new ArrayList<Double>();long seriesStart=System.nanoTime();
            for(int frame=1;frame<=FRAMES;frame++) {
                stage="FRAME_"+frame;
                long eventStart=System.nanoTime();probe.writer.writeInstruction(new GuacamoleInstruction("mouse",Integer.toString(frame),"8","0"));
                probe.readFrame();timings.add((System.nanoTime()-eventStart)/1_000_000.0);
            }
            double durationSeconds=(System.nanoTime()-seriesStart)/1_000_000_000.0;
            stage="VALIDATE_COUNTERS";
            require(fixture.framesSent==FRAMES+1&&fixture.pointersReceived==FRAMES,"FRAME_CORRELATION_FAILED");
            require(fixture.format.depth()==(profile.equals("low")?Integer.parseInt(PROFILES.get("low").get("color-depth")):24),"COLOUR_DEPTH_MISMATCH");
            stage="CLOSE";probe.close();fixture.close();fixture.finished.get(3,TimeUnit.SECONDS);
            var result=new LinkedHashMap<String,Object>();
            result.put("profile",profile);result.put("targetCapabilities",capability);result.put("repeat",repeat);
            result.put("status","PASS");result.put("settings",PROFILES.get(profile));
            result.put("requestedEncodings",fixture.requestedEncodings);result.put("negotiatedEncoding",fixture.chosenEncoding);
            result.put("negotiatedPixelBits",fixture.format.bits());result.put("negotiatedColorDepth",fixture.format.depth());
            result.put("observedCompressionLevel",fixture.compression);result.put("observedJpegQualityPseudoEncoding",fixture.quality);
            result.put("framesReceived",FRAMES);result.put("rfbFramesIncludingInitial",fixture.framesSent);
            result.put("rfbDownloadBytesIncludingInitialAndHandshake",fixture.bytesSent);
            result.put("rfbUploadBytesIncludingInitialAndHandshake",fixture.bytesReceived);
            result.put("rfbImagePayloadBytesIncludingInitial",fixture.pixelPayloadBytes);
            long download=probe.input.count.get()-wireStart;
            result.put("guacamoleDownloadBytesAfterInitial",download);result.put("guacamoleUploadBytesAfterInitial",probe.output.count.get()-uploadStart);
            result.put("encodedImageBytesAfterInitial",probe.decodedImageBytes-imagesStart);
            result.put("base64ImageBytesAfterInitial",probe.base64ImageBytes-base64Start);result.put("guacamoleImageTypes",probe.imageTypes);
            result.put("measuredDurationSeconds",durationSeconds);result.put("measuredPayloadKibPerSecond",download/durationSeconds/1024);
            result.put("connectHandshakeMs",handshakeMs);result.put("firstFrameMs",firstFrameMs);
            result.put("syntheticPointerToFrameSyncMs",Map.of("median",percentile(timings,0.5),"p95",percentile(timings,0.95),"samples",timings));
            return result;
        }catch(Exception failure){throw new IllegalStateException("BENCHMARK_STAGE_"+profile+"_"+capability+"_"+repeat+"_"+stage+"_"+failure.getClass().getSimpleName()+"_PEER_"+peerFailure);}
    }
    private static double percentile(List<Double> values,double fraction) {
        var sorted=new ArrayList<>(values);Collections.sort(sorted);return sorted.get((int)Math.ceil(sorted.size()*fraction)-1);
    }
    private static void waitForDaemon()throws Exception {
        long deadline=System.nanoTime()+Duration.ofSeconds(8).toNanos();
        while(true)try(Socket socket=new Socket()){socket.connect(new InetSocketAddress("127.0.0.1",4822),250);return;}
        catch(ConnectException ignored){if(System.nanoTime()>=deadline)throw ignored;Thread.sleep(100);}
    }
    public static void main(String[] args)throws Exception {
        java.util.logging.LogManager.getLogManager().reset();
        var timer=Executors.newSingleThreadScheduledExecutor(r->{Thread thread=new Thread(r,"rdg-benchmark-deadline");thread.setDaemon(true);return thread;});
        timer.schedule(()->System.exit(124),90,TimeUnit.SECONDS);
        try {
            waitForDaemon();PROFILES=productionProfiles();var results=new ArrayList<Map<String,Object>>();
            String mode=args.length==0?"full":args[0];
            boolean candidate=Set.of("candidate8","candidate16lossless","candidate8lossless").contains(mode);
            require(args.length<=1&&(mode.equals("full")||candidate),"BENCHMARK_MODE_INVALID");
            if(candidate) {
                PROFILES=new LinkedHashMap<>(PROFILES);
                PROFILES.put("low",Map.of("color-depth",mode.equals("candidate16lossless")?"16":"8",
                    "force-lossless",mode.endsWith("lossless")?"true":"false"));
            }
            if(candidate)results.add(run("low","ZLIB_RAW",1));
            else for(String capability:List.of("RAW_ONLY","ZLIB_RAW"))for(String profile:List.of("balanced","low","clear"))
                for(int repeat=1;repeat<=REPEATS;repeat++){results.add(run(profile,capability,repeat));Thread.sleep(150);}
            var output=new LinkedHashMap<String,Object>();output.put("schemaVersion",1);output.put("status","PASS");
            output.put("scope","ISOLATED_OFFICIAL_GUACD_SYNTHETIC_BYTE_BENCHMARK");output.put("recordedAt",Instant.now().toString());
            output.put("officialGuacamoleVersion","1.6.0");output.put("resolution",Map.of("width",WIDTH,"height",HEIGHT));
            output.put("pattern","DETERMINISTIC_SYNTHETIC_ANIMATED_GRADIENT_WITH_NOISE");output.put("repeatsPerProfile",candidate?1:REPEATS);
            output.put("mode",mode);
            output.put("presetSource",candidate?"EXPERIMENTAL_LOW_OVERRIDE":"COMPILED_PRODUCTION_DISPLAY_QUALITY_SNAPSHOT");
            output.put("framesPerRepeatExcludingInitial",FRAMES);output.put("results",results);
            output.put("limits",List.of("No real Mac, browser rendering, Cloudflare, WAN or host input latency is measured.",
                "Guacamole byte counts are actual TCP payload bytes before WebSocket/TLS/HTTP framing; they are not internet wire bytes.",
                "Raw-only target ignores compression levels; selected color depth remains negotiated.",
                "The production defaults exclude Tight, and this fixture does not send Tight rectangles or JPEG VNC data.",
                "Zlib uses the observed negotiated compression level; production does not override the late-applied1.6.0 compression parameter.",
                "force-lossless governs daemon-to-client graphical encoding; it does not restore upstream JPEG detail.",
                "Pointer timings include fixture frame generation/encoding and guacd processing, without real input events or screen capture."));
            System.out.println(new ObjectMapper().writeValueAsString(output));
        }catch(Exception failure){System.err.println("SYNTHETIC_BANDWIDTH_BENCHMARK_FAILED");
            if(failure.getMessage()!=null&&failure.getMessage().matches("BENCHMARK_STAGE_[A-Za-z0-9_]+"))System.err.println(failure.getMessage());
            System.exit(1);}
        finally{timer.shutdownNow();}
    }
}
