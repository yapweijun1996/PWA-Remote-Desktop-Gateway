package com.rdg;

import org.apache.guacamole.protocol.*;
import java.util.*;

/** Semantic allowlist after the official parser; no arbitrary protocol/target selection. */
final class InputPolicy {
    private final Sessions.Desktop desktop;
    private String clipboardIndex;
    private int clipboardBytes;
    InputPolicy(Sessions.Desktop desktop) {this.desktop=desktop;}
    void validate(GuacamoleInstruction i) {
        var args=i.getArgs();String op=i.getOpcode();
        desktop.checkActive();
        switch(op) {
            case "" -> { if(args.size()!=2 || !args.get(0).equals("ping") || args.get(1).length()>32)deny(); }
            case "sync" -> {if(args.size()<1||args.size()>2)deny();for(String a:args)number(a,0,Long.MAX_VALUE);}
            case "ack" -> {if(args.size()!=3 || args.get(1).length()>128)deny();number(args.get(0),0,255);number(args.get(2),0,65535);}
            case "size" -> {if(args.size()!=2)deny();number(args.get(0),1,8192);number(args.get(1),1,8192);}
            case "nop", "disconnect" -> {if(!args.isEmpty())deny();}
            case "key" -> {
                control();if(args.size()!=2)deny();number(args.get(0),1,0x1fffffff);number(args.get(1),0,1);desktop.activity();
            }
            case "mouse" -> {
                control();if(args.size()!=3)deny();number(args.get(0),0,32767);number(args.get(1),0,32767);number(args.get(2),0,31);desktop.activity();
            }
            case "clipboard" -> {
                control();if(!desktop.clipboard || clipboardIndex!=null || args.size()!=2 || !args.get(1).equals("text/plain"))deny();
                number(args.get(0),0,255);clipboardIndex=args.get(0);clipboardBytes=0;
            }
            case "blob" -> {
                control();if(!desktop.clipboard||args.size()!=2||!args.get(0).equals(clipboardIndex))deny();
                try {clipboardBytes+=Base64.getDecoder().decode(args.get(1)).length;}catch(IllegalArgumentException e){deny();}
                if(clipboardBytes>16384)deny();desktop.activity();
            }
            case "end" -> {control();if(args.size()!=1||!args.get(0).equals(clipboardIndex))deny();clipboardIndex=null;clipboardBytes=0;}
            default -> deny();
        }
    }
    private void control() {if(!desktop.mode.equals("control"))throw new Failure(403,"READ_ONLY");}
    private static void number(String s,long min,long max) {try{if(!s.matches("[0-9]{1,19}"))deny();long n=Long.parseLong(s);if(n<min||n>max)deny();}catch(NumberFormatException e){deny();}}
    private static void deny() {throw new Failure(403,"INPUT_DENIED");}
}
