package com.kuan.twsbridge;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling 
public class TwsBridgeApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(TwsBridgeApplication.class, args);
    }
}
