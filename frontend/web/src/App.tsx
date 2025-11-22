import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface HabitData {
  id: number;
  name: string;
  frequency: string;
  category: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  streakCount?: number;
}

interface HabitStats {
  totalHabits: number;
  completedToday: number;
  currentStreak: number;
  successRate: number;
  weeklyTrend: number[];
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [habits, setHabits] = useState<HabitData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingHabit, setCreatingHabit] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newHabitData, setNewHabitData] = useState({ name: "", frequency: "1", category: "健康" });
  const [selectedHabit, setSelectedHabit] = useState<HabitData | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [operationHistory, setOperationHistory] = useState<string[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
        addToHistory("FHE系统初始化完成");
      } catch (error) {
        console.error('FHEVM初始化失败:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('数据加载失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const addToHistory = (operation: string) => {
    setOperationHistory(prev => [
      `${new Date().toLocaleTimeString()}: ${operation}`,
      ...prev.slice(0, 9)
    ]);
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const habitsList: HabitData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          habitsList.push({
            id: parseInt(businessId.replace('habit-', '')) || Date.now(),
            name: businessData.name,
            frequency: businessData.description,
            category: getCategoryFromValue(businessData.publicValue2),
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            streakCount: Number(businessData.publicValue1) || 0
          });
        } catch (e) {
          console.error('加载习惯数据错误:', e);
        }
      }
      
      setHabits(habitsList);
      addToHistory(`加载了 ${habitsList.length} 个习惯记录`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "数据加载失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const getCategoryFromValue = (value: number): string => {
    const categories = ["健康", "学习", "工作", "生活", "运动", "其他"];
    return categories[value % categories.length] || "其他";
  };

  const getCategoryValue = (category: string): number => {
    const categories = ["健康", "学习", "工作", "生活", "运动", "其他"];
    return categories.indexOf(category);
  };

  const createHabit = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingHabit(true);
    setTransactionStatus({ visible: true, status: "pending", message: "创建加密习惯记录..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const streakValue = parseInt(newHabitData.frequency) || 1;
      const businessId = `habit-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, streakValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newHabitData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        streakValue,
        getCategoryValue(newHabitData.category),
        newHabitData.category
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "习惯创建成功!" });
      addToHistory(`创建习惯: ${newHabitData.name}`);
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewHabitData({ name: "", frequency: "1", category: "健康" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingHabit(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "链上验证解密中..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addToHistory(`解密习惯数据: ${clearValue}`);
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "合约可用性检查成功" 
      });
      addToHistory("执行合约可用性检查");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "合约检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getHabitStats = (): HabitStats => {
    const totalHabits = habits.length;
    const completedToday = habits.filter(h => h.publicValue1 > 0).length;
    const currentStreak = habits.reduce((max, h) => Math.max(max, h.publicValue1 || 0), 0);
    const successRate = totalHabits > 0 ? Math.round((completedToday / totalHabits) * 100) : 0;
    
    const weeklyTrend = [0, 0, 0, 0, 0, 0, 0];
    habits.forEach(habit => {
      const dayOfWeek = new Date(habit.timestamp * 1000).getDay();
      weeklyTrend[dayOfWeek] += habit.publicValue1 || 0;
    });

    return { totalHabits, completedToday, currentStreak, successRate, weeklyTrend };
  };

  const filteredHabits = habits.filter(habit => {
    const matchesSearch = habit.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || habit.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ["all", ...Array.from(new Set(habits.map(h => h.category)))];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <h1>🔐 隐私习惯养成</h1>
            <span className="tagline">FHE加密 · 安全追踪</span>
          </div>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt metal-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>连接钱包开始加密习惯追踪</h2>
            <p>使用FHE全同态加密技术，保护您的习惯数据隐私</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>连接钱包启用加密系统</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>创建隐私习惯记录</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>查看加密数据分析</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen metal-loading">
        <div className="fhe-spinner metal-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p className="loading-note">正在加载同态加密环境</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen metal-loading">
      <div className="fhe-spinner metal-spinner"></div>
      <p>加载加密习惯数据...</p>
    </div>
  );

  const stats = getHabitStats();

  return (
    <div className="app-container metal-theme">
      <header className="app-header metal-header">
        <div className="logo">
          <h1>🔐 隐私习惯养成</h1>
          <span className="tagline">FHE加密 · 安全追踪</span>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn metal-btn">
            检查合约
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn primary"
          >
            + 新建习惯
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container dashboard-layout">
        <div className="stats-sidebar metal-sidebar">
          <div className="stats-panel metal-panel">
            <h3>📊 习惯统计</h3>
            <div className="stat-item">
              <span>总习惯数</span>
              <strong>{stats.totalHabits}</strong>
            </div>
            <div className="stat-item">
              <span>今日完成</span>
              <strong>{stats.completedToday}</strong>
            </div>
            <div className="stat-item">
              <span>当前连胜</span>
              <strong>{stats.currentStreak}天</strong>
            </div>
            <div className="stat-item">
              <span>成功率</span>
              <strong>{stats.successRate}%</strong>
            </div>
          </div>

          <div className="chart-panel metal-panel">
            <h3>📈 每周趋势</h3>
            <div className="week-chart">
              {stats.weeklyTrend.map((value, index) => (
                <div key={index} className="chart-bar">
                  <div 
                    className="bar-fill" 
                    style={{ height: `${Math.min(100, value * 20)}%` }}
                    title={`${value}次`}
                  ></div>
                  <span>周{index + 1}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="history-panel metal-panel">
            <h3>⏰ 操作记录</h3>
            <div className="history-list">
              {operationHistory.map((record, index) => (
                <div key={index} className="history-item">
                  {record}
                </div>
              ))}
              {operationHistory.length === 0 && (
                <div className="no-history">暂无操作记录</div>
              )}
            </div>
          </div>
        </div>
        
        <div className="habits-main metal-main">
          <div className="search-section">
            <div className="search-bar">
              <input 
                type="text" 
                placeholder="搜索习惯名称..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="metal-input"
              />
              <select 
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="metal-select"
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat === "all" ? "全部分类" : cat}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="actions-bar">
              <button 
                onClick={loadData} 
                className="refresh-btn metal-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "刷新中..." : "🔄 刷新"}
              </button>
            </div>
          </div>

          <div className="habits-grid">
            {filteredHabits.length === 0 ? (
              <div className="no-habits metal-panel">
                <p>暂无习惯记录</p>
                <button 
                  className="create-btn metal-btn primary" 
                  onClick={() => setShowCreateModal(true)}
                >
                  创建第一个习惯
                </button>
              </div>
            ) : filteredHabits.map((habit, index) => (
              <div 
                className={`habit-card metal-card ${selectedHabit?.id === habit.id ? "selected" : ""} ${habit.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedHabit(habit)}
              >
                <div className="habit-header">
                  <h3>{habit.name}</h3>
                  <span className={`category-badge ${habit.category}`}>
                    {habit.category}
                  </span>
                </div>
                <div className="habit-meta">
                  <span>频率: {habit.publicValue1}次/天</span>
                  <span>创建: {new Date(habit.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="habit-status">
                  {habit.isVerified ? (
                    <span className="status-verified">✅ 已验证: {habit.decryptedValue}次</span>
                  ) : (
                    <span className="status-encrypted">🔒 加密数据</span>
                  )}
                </div>
                <div className="habit-creator">
                  创建者: {habit.creator.substring(0, 6)}...{habit.creator.substring(38)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateHabit 
          onSubmit={createHabit} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingHabit} 
          habitData={newHabitData} 
          setHabitData={setNewHabitData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedHabit && (
        <HabitDetailModal 
          habit={selectedHabit} 
          onClose={() => { 
            setSelectedHabit(null); 
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(`habit-${selectedHabit.id}`)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal metal-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateHabit: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  habitData: any;
  setHabitData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, habitData, setHabitData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setHabitData({ ...habitData, [name]: value });
  };

  const categories = ["健康", "学习", "工作", "生活", "运动", "其他"];

  return (
    <div className="modal-overlay metal-overlay">
      <div className="create-habit-modal metal-modal">
        <div className="modal-header">
          <h2>新建隐私习惯</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-notice">
            <strong>🔐 FHE同态加密</strong>
            <p>习惯频率数据将使用Zama FHE进行加密（仅支持整数）</p>
          </div>
          
          <div className="form-group">
            <label>习惯名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={habitData.name} 
              onChange={handleChange} 
              placeholder="输入习惯名称..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>每日频率（整数） *</label>
            <input 
              type="number" 
              name="frequency" 
              value={habitData.frequency} 
              onChange={handleChange} 
              placeholder="输入每日目标次数..." 
              step="1"
              min="1"
              className="metal-input"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>分类 *</label>
            <select 
              name="category" 
              value={habitData.category} 
              onChange={handleChange}
              className="metal-select"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <div className="data-type-label">公开数据</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !habitData.name || !habitData.frequency} 
            className="submit-btn metal-btn primary"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建习惯"}
          </button>
        </div>
      </div>
    </div>
  );
};

const HabitDetailModal: React.FC<{
  habit: HabitData;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ habit, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) { 
      setDecryptedData(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  return (
    <div className="modal-overlay metal-overlay">
      <div className="habit-detail-modal metal-modal">
        <div className="modal-header">
          <h2>习惯详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="habit-info">
            <div className="info-item">
              <span>习惯名称:</span>
              <strong>{habit.name}</strong>
            </div>
            <div className="info-item">
              <span>分类:</span>
              <strong>{habit.category}</strong>
            </div>
            <div className="info-item">
              <span>创建者:</span>
              <strong>{habit.creator.substring(0, 6)}...{habit.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>创建时间:</span>
              <strong>{new Date(habit.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>🔐 加密频率数据</h3>
            
            <div className="data-row">
              <div className="data-label">目标频率:</div>
              <div className="data-value">
                {habit.isVerified ? 
                  `${habit.decryptedValue} 次/天 (链上已验证)` : 
                  decryptedData !== null ? 
                  `${decryptedData} 次/天 (本地解密)` : 
                  "🔒 FHE加密整数"
                }
              </div>
              <button 
                className={`decrypt-btn metal-btn ${(habit.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : habit.isVerified ? (
                  "✅ 已验证"
                ) : decryptedData !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>
            
            <div className="fhe-info metal-notice">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE同态加密保护</strong>
                <p>频率数据在链上加密存储，点击验证进行离线解密和链上验证</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">关闭</button>
          {!habit.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn primary"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

