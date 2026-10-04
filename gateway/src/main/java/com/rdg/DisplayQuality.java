package com.rdg;

import org.apache.guacamole.protocol.GuacamoleConfiguration;
import java.util.List;
import java.util.Map;

/** Server-owned VNC display presets; bandwidth depends on workload and target support. */
enum DisplayQuality {
    // Preserve guacd's encoding defaults; enabling Tight would expose the pinned libvncclient advisory.
    // The approved Mac returns UPSTREAM_ERROR for 8-bit output; 16-bit was verified live.
    LOW("low",Map.of("color-depth","16","force-lossless","true")),
    BALANCED("balanced",Map.of()),
    CLEAR("clear",Map.of("color-depth","24","force-lossless","true"));

    final String id;
    private final Map<String,String> parameters;
    DisplayQuality(String id,Map<String,String> parameters){this.id=id;this.parameters=parameters;}
    static DisplayQuality parse(String id) {
        for(var quality:values())if(quality.id.equals(id))return quality;
        throw new Failure(400,"INVALID_REQUEST");
    }
    static List<String> ids(){return List.of(LOW.id,BALANCED.id,CLEAR.id);}
    void apply(GuacamoleConfiguration vnc){parameters.forEach(vnc::setParameter);}
}
