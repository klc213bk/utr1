package com.kuan.twsbridge.service;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kuan.twsbridge.model.CollectionRun;
import com.kuan.twsbridge.model.DailyCoverage;
import com.kuan.twsbridge.model.DataGap;
import com.kuan.twsbridge.repository.CollectionRunRepository;
import com.kuan.twsbridge.repository.DataCoverageRepository;

@Service
public class DataCoverageService {
    
    private static final Logger log = LoggerFactory.getLogger(DataCoverageService.class);
    
    private final DataCoverageRepository coverageRepository;
    private final CollectionRunRepository runRepository;
    
    public DataCoverageService(DataCoverageRepository coverageRepository,
                               CollectionRunRepository runRepository) {
        this.coverageRepository = coverageRepository;
        this.runRepository = runRepository;
    }
    
    /**
     * Get data coverage for specified days
     * Business logic: Calculate percentages, identify issues
     */
    public Map<String, Object> getDataCoverage(int days) {
        // Business logic here
        List<DailyCoverage> coverageList = coverageRepository.getDailyCoverage(days);
        
        // Calculate statistics
        long completeDays = coverageList.stream()
            .filter(DailyCoverage::isComplete)
            .count();
        
        double avgCoverage = coverageList.stream()
            .mapToDouble(DailyCoverage::getCoveragePercentage)
            .average()
            .orElse(0.0);
        
        // Identify problem days
        List<DailyCoverage> incompleteDays = coverageList.stream()
            .filter(day -> !day.isComplete() && day.isTradingDay())
            .collect(Collectors.toList());
        
        return Map.of(
            "success", true,
            "days", coverageList.size(),
            "completeDays", completeDays,
            "averageCoverage", avgCoverage,
            "incompleteDays", incompleteDays,
            "coverage", coverageList
        );
    }
    
    /**
     * Get collection run history with analysis
     */
    public Map<String, Object> getCollectionHistory(int limit) {
        List<CollectionRun> history = runRepository.getRecentRuns(limit);
        
        // Add business metrics
        long successCount = history.stream()
            .filter(run -> "completed".equals(run.getStatus()))
            .count();
        
        double successRate = history.isEmpty() ? 0 : 
            (double) successCount / history.size() * 100;
        
        return Map.of(
            "success", true,
            "history", history,
            "totalRuns", history.size(),
            "successRate", successRate
        );
    }
    
    /**
     * Detect gaps and create fill tasks
     */
    @Transactional
    public Map<String, Object> detectAndQueueGaps(int daysBack) {
        // Business logic for gap detection
        LocalDate startDate = LocalDate.now().minusDays(daysBack);
        LocalDate endDate = LocalDate.now();
        
        List<DataGap> gaps = coverageRepository.detectGaps(startDate, endDate);
        
        int queued = 0;
        for (DataGap gap : gaps) {
            if (shouldQueueGap(gap)) {
                runRepository.queueGapFill(gap);
                queued++;
            }
        }
        
        return Map.of(
            "success", true,
            "gapsDetected", gaps.size(),
            "gapsQueued", queued,
            "message", String.format("Detected %d gaps, queued %d for filling", 
                                    gaps.size(), queued)
        );
    }
    
    private boolean shouldQueueGap(DataGap gap) {
        // Business rule: Only queue gaps during market hours, not too old, etc.
        return gap.getMinutes() > 5 && // Ignore tiny gaps
               gap.getDaysOld() < 90 &&  // Don't fill very old gaps
               !gap.isBeingFilled();      // Not already in progress
    }
}