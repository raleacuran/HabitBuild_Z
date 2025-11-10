pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedHabitTracker is ZamaEthereumConfig {
    
    struct HabitEntry {
        string habitName;                    
        euint32 encryptedFrequency;        
        uint256 streakCount;          
        uint256 targetCount;          
        string category;            
        address owner;               
        uint256 lastUpdated;             
        uint32 decryptedFrequency; 
        bool isVerified; 
    }
    

    mapping(string => HabitEntry) public habitEntries;
    
    string[] public habitIds;
    
    event HabitEntryCreated(string indexed habitId, address indexed owner);
    event DecryptionVerified(string indexed habitId, uint32 decryptedFrequency);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createHabitEntry(
        string calldata habitId,
        string calldata habitName,
        externalEuint32 encryptedFrequency,
        bytes calldata inputProof,
        uint256 streakCount,
        uint256 targetCount,
        string calldata category
    ) external {
        require(bytes(habitEntries[habitId].habitName).length == 0, "Habit entry already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedFrequency, inputProof)), "Invalid encrypted input");
        
        habitEntries[habitId] = HabitEntry({
            habitName: habitName,
            encryptedFrequency: FHE.fromExternal(encryptedFrequency, inputProof),
            streakCount: streakCount,
            targetCount: targetCount,
            category: category,
            owner: msg.sender,
            lastUpdated: block.timestamp,
            decryptedFrequency: 0,
            isVerified: false
        });
        
        FHE.allowThis(habitEntries[habitId].encryptedFrequency);
        
        FHE.makePubliclyDecryptable(habitEntries[habitId].encryptedFrequency);
        
        habitIds.push(habitId);
        
        emit HabitEntryCreated(habitId, msg.sender);
    }
    
    function verifyDecryption(
        string calldata habitId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(habitEntries[habitId].habitName).length > 0, "Habit entry does not exist");
        require(!habitEntries[habitId].isVerified, "Data already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(habitEntries[habitId].encryptedFrequency);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        habitEntries[habitId].decryptedFrequency = decodedValue;
        habitEntries[habitId].isVerified = true;
        
        emit DecryptionVerified(habitId, decodedValue);
    }
    
    function getEncryptedFrequency(string calldata habitId) external view returns (euint32) {
        require(bytes(habitEntries[habitId].habitName).length > 0, "Habit entry does not exist");
        return habitEntries[habitId].encryptedFrequency;
    }
    
    function getHabitEntry(string calldata habitId) external view returns (
        string memory habitName,
        uint256 streakCount,
        uint256 targetCount,
        string memory category,
        address owner,
        uint256 lastUpdated,
        bool isVerified,
        uint32 decryptedFrequency
    ) {
        require(bytes(habitEntries[habitId].habitName).length > 0, "Habit entry does not exist");
        HabitEntry storage entry = habitEntries[habitId];
        
        return (
            entry.habitName,
            entry.streakCount,
            entry.targetCount,
            entry.category,
            entry.owner,
            entry.lastUpdated,
            entry.isVerified,
            entry.decryptedFrequency
        );
    }
    
    function getAllHabitIds() external view returns (string[] memory) {
        return habitIds;
    }
    
    function updateHabitStreak(string calldata habitId, uint256 newStreakCount) external {
        require(bytes(habitEntries[habitId].habitName).length > 0, "Habit entry does not exist");
        require(msg.sender == habitEntries[habitId].owner, "Only owner can update");
        
        habitEntries[habitId].streakCount = newStreakCount;
        habitEntries[habitId].lastUpdated = block.timestamp;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

