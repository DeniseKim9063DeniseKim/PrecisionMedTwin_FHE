// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PrecisionMedTwin is SepoliaConfig {
    struct EncryptedHealthData {
        uint256 patientId;
        euint32[] genomicData;      // Encrypted genomic data
        euint32[] cellularData;     // Encrypted cellular-level data
        euint32[] organData;        // Encrypted organ-level data
        euint32[] biomarkers;       // Encrypted biomarkers
        uint256 timestamp;
    }
    
    struct SimulationResult {
        euint32 diseaseRiskScore;   // Encrypted disease risk score
        euint32[] drugResponse;     // Encrypted drug response predictions
        bool isComplete;
    }
    
    struct DecryptedResult {
        uint32 diseaseRiskScore;
        uint32[] drugResponse;
        bool isRevealed;
    }
    
    // Contract state
    mapping(uint256 => EncryptedHealthData) public patientData;
    mapping(uint256 => SimulationResult) public simulationResults;
    mapping(uint256 => DecryptedResult) public decryptedResults;
    
    // Multi-scale model parameters
    euint32[] private genomicModelParams;
    euint32[] private cellularModelParams;
    euint32[] private organModelParams;
    
    // Decryption requests tracking
    mapping(uint256 => uint256) private requestToPatientId;
    
    // Events
    event DataSubmitted(uint256 indexed patientId, uint256 timestamp);
    event SimulationRequested(uint256 indexed patientId);
    event SimulationCompleted(uint256 indexed patientId);
    event ResultRevealed(uint256 indexed patientId);
    
    modifier onlyAuthorized(uint256 patientId) {
        // Access control placeholder (e.g., patient or authorized physician)
        _;
    }
    
    /// @notice Submit encrypted health data for a patient
    function submitHealthData(
        uint256 patientId,
        euint32[] memory genomic,
        euint32[] memory cellular,
        euint32[] memory organ,
        euint32[] memory biomarkers
    ) public {
        patientData[patientId] = EncryptedHealthData({
            patientId: patientId,
            genomicData: genomic,
            cellularData: cellular,
            organData: organ,
            biomarkers: biomarkers,
            timestamp: block.timestamp
        });
        
        emit DataSubmitted(patientId, block.timestamp);
    }
    
    /// @notice Set model parameters for multi-scale simulations
    function setModelParameters(
        euint32[] memory genomicParams,
        euint32[] memory cellularParams,
        euint32[] memory organParams
    ) public {
        genomicModelParams = genomicParams;
        cellularModelParams = cellularParams;
        organModelParams = organParams;
    }
    
    /// @notice Request disease and drug response simulation
    function requestSimulation(uint256 patientId) public onlyAuthorized(patientId) {
        EncryptedHealthData storage data = patientData[patientId];
        require(data.timestamp > 0, "Patient data not found");
        
        emit SimulationRequested(patientId);
    }
    
    /// @notice Store encrypted simulation results
    function storeSimulationResult(
        uint256 patientId,
        euint32 diseaseRisk,
        euint32[] memory drugResponses
    ) public {
        simulationResults[patientId] = SimulationResult({
            diseaseRiskScore: diseaseRisk,
            drugResponse: drugResponses,
            isComplete: true
        });
        
        decryptedResults[patientId] = DecryptedResult({
            diseaseRiskScore: 0,
            drugResponse: new uint32[](0),
            isRevealed: false
        });
        
        emit SimulationCompleted(patientId);
    }
    
    /// @notice Request decryption of simulation results
    function requestResultDecryption(uint256 patientId) public onlyAuthorized(patientId) {
        SimulationResult storage result = simulationResults[patientId];
        require(result.isComplete, "Simulation not complete");
        require(!decryptedResults[patientId].isRevealed, "Already revealed");
        
        // Prepare all ciphertexts for decryption
        uint256 totalElements = 1 + result.drugResponse.length;
        bytes32[] memory ciphertexts = new bytes32[](totalElements);
        
        ciphertexts[0] = FHE.toBytes32(result.diseaseRiskScore);
        for (uint i = 0; i < result.drugResponse.length; i++) {
            ciphertexts[i+1] = FHE.toBytes32(result.drugResponse[i]);
        }
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptSimulationResult.selector);
        requestToPatientId[reqId] = patientId;
    }
    
    /// @notice Callback for decrypted simulation results
    function decryptSimulationResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 patientId = requestToPatientId[requestId];
        require(patientId != 0, "Invalid request");
        
        SimulationResult storage sResult = simulationResults[patientId];
        DecryptedResult storage dResult = decryptedResults[patientId];
        require(!dResult.isRevealed, "Already revealed");
        
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted values
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        
        dResult.diseaseRiskScore = results[0];
        dResult.drugResponse = new uint32[](results.length - 1);
        
        for (uint i = 1; i < results.length; i++) {
            dResult.drugResponse[i-1] = results[i];
        }
        
        dResult.isRevealed = true;
        
        emit ResultRevealed(patientId);
    }
    
    /// @notice Perform encrypted disease risk prediction
    function predictDiseaseRisk(uint256 patientId) public view returns (euint32) {
        EncryptedHealthData storage data = patientData[patientId];
        require(data.timestamp > 0, "Patient data not found");
        
        // Simplified linear model: risk = Σ (genomicParams[i] * genomicData[i])
        euint32 risk = FHE.asEuint32(0);
        
        for (uint i = 0; i < genomicModelParams.length; i++) {
            if (i < data.genomicData.length) {
                risk = FHE.add(risk, FHE.mul(genomicModelParams[i], data.genomicData[i]));
            }
        }
        
        return risk;
    }
    
    /// @notice Perform encrypted drug response prediction
    function predictDrugResponse(uint256 patientId, uint256 drugIndex) public view returns (euint32) {
        EncryptedHealthData storage data = patientData[patientId];
        require(data.timestamp > 0, "Patient data not found");
        
        // Simplified model combining genomic and biomarker data
        euint32 response = FHE.asEuint32(0);
        
        // Genomic contribution
        for (uint i = 0; i < genomicModelParams.length; i++) {
            if (i < data.genomicData.length) {
                response = FHE.add(response, FHE.mul(genomicModelParams[i], data.genomicData[i]));
            }
        }
        
        // Biomarker contribution
        if (drugIndex < data.biomarkers.length) {
            response = FHE.add(response, data.biomarkers[drugIndex]);
        }
        
        return response;
    }
    
    /// @notice Get encrypted health data
    function getEncryptedHealthData(uint256 patientId) public view returns (
        euint32[] memory genomic,
        euint32[] memory cellular,
        euint32[] memory organ,
        euint32[] memory biomarkers
    ) {
        EncryptedHealthData storage data = patientData[patientId];
        require(data.timestamp > 0, "Patient data not found");
        return (data.genomicData, data.cellularData, data.organData, data.biomarkers);
    }
    
    /// @notice Get encrypted simulation result
    function getEncryptedSimulationResult(uint256 patientId) public view returns (
        euint32 diseaseRisk,
        euint32[] memory drugResponse
    ) {
        SimulationResult storage r = simulationResults[patientId];
        require(r.isComplete, "Simulation not complete");
        return (r.diseaseRiskScore, r.drugResponse);
    }
    
    /// @notice Get decrypted simulation result
    function getDecryptedSimulationResult(uint256 patientId) public view returns (
        uint32 diseaseRisk,
        uint32[] memory drugResponse,
        bool isRevealed
    ) {
        DecryptedResult storage r = decryptedResults[patientId];
        return (r.diseaseRiskScore, r.drugResponse, r.isRevealed);
    }
    
    /// @notice Update multi-scale model parameters
    function updateGenomicModel(euint32[] memory newParams) public {
        genomicModelParams = newParams;
    }
    
    function updateCellularModel(euint32[] memory newParams) public {
        cellularModelParams = newParams;
    }
    
    function updateOrganModel(euint32[] memory newParams) public {
        organModelParams = newParams;
    }
}