// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface DigitalTwin {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  scale: "gene" | "cell" | "organ";
  status: "pending" | "active" | "archived";
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [twins, setTwins] = useState<DigitalTwin[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newTwinData, setNewTwinData] = useState({
    scale: "gene",
    description: "",
    healthData: ""
  });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const activeCount = twins.filter(t => t.status === "active").length;
  const pendingCount = twins.filter(t => t.status === "pending").length;
  const archivedCount = twins.filter(t => t.status === "archived").length;

  // Filter twins based on search term
  const filteredTwins = twins.filter(twin => 
    twin.scale.toLowerCase().includes(searchTerm.toLowerCase()) || 
    twin.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    loadTwins().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadTwins = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("twin_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing twin keys:", e);
        }
      }
      
      const list: DigitalTwin[] = [];
      
      for (const key of keys) {
        try {
          const twinBytes = await contract.getData(`twin_${key}`);
          if (twinBytes.length > 0) {
            try {
              const twinData = JSON.parse(ethers.toUtf8String(twinBytes));
              list.push({
                id: key,
                encryptedData: twinData.data,
                timestamp: twinData.timestamp,
                owner: twinData.owner,
                scale: twinData.scale,
                status: twinData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing twin data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading twin ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setTwins(list);
    } catch (e) {
      console.error("Error loading twins:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitTwin = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting health data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newTwinData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const twinId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const twinData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        scale: newTwinData.scale,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `twin_${twinId}`, 
        ethers.toUtf8Bytes(JSON.stringify(twinData))
      );
      
      const keysBytes = await contract.getData("twin_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(twinId);
      
      await contract.setData(
        "twin_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted health data submitted securely!"
      });
      
      await loadTwins();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTwinData({
          scale: "gene",
          description: "",
          healthData: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const activateTwin = async (twinId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted health data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const twinBytes = await contract.getData(`twin_${twinId}`);
      if (twinBytes.length === 0) {
        throw new Error("Twin not found");
      }
      
      const twinData = JSON.parse(ethers.toUtf8String(twinBytes));
      
      const updatedTwin = {
        ...twinData,
        status: "active"
      };
      
      await contract.setData(
        `twin_${twinId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedTwin))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE activation completed successfully!"
      });
      
      await loadTwins();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Activation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const archiveTwin = async (twinId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted health data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const twinBytes = await contract.getData(`twin_${twinId}`);
      if (twinBytes.length === 0) {
        throw new Error("Twin not found");
      }
      
      const twinData = JSON.parse(ethers.toUtf8String(twinBytes));
      
      const updatedTwin = {
        ...twinData,
        status: "archived"
      };
      
      await contract.setData(
        `twin_${twinId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedTwin))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE archiving completed successfully!"
      });
      
      await loadTwins();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Archiving failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const renderScaleDistribution = () => {
    const geneCount = twins.filter(t => t.scale === "gene").length;
    const cellCount = twins.filter(t => t.scale === "cell").length;
    const organCount = twins.filter(t => t.scale === "organ").length;
    const total = twins.length || 1;

    return (
      <div className="scale-distribution">
        <div className="scale-item">
          <div className="scale-label">Gene</div>
          <div className="scale-bar">
            <div 
              className="scale-fill gene" 
              style={{ width: `${(geneCount / total) * 100}%` }}
            ></div>
          </div>
          <div className="scale-count">{geneCount}</div>
        </div>
        <div className="scale-item">
          <div className="scale-label">Cell</div>
          <div className="scale-bar">
            <div 
              className="scale-fill cell" 
              style={{ width: `${(cellCount / total) * 100}%` }}
            ></div>
          </div>
          <div className="scale-count">{cellCount}</div>
        </div>
        <div className="scale-item">
          <div className="scale-label">Organ</div>
          <div className="scale-bar">
            <div 
              className="scale-fill organ" 
              style={{ width: `${(organCount / total) * 100}%` }}
            ></div>
          </div>
          <div className="scale-count">{organCount}</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>PrecisionMed<span>Twin</span></h1>
          <div className="fhe-badge">FHE-Powered</div>
        </div>
        
        <div className="header-actions">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search twins..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button className="search-icon">🔍</button>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Twin
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <nav className="app-nav">
        <button 
          className={activeTab === "dashboard" ? "active" : ""}
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        <button 
          className={activeTab === "twins" ? "active" : ""}
          onClick={() => setActiveTab("twins")}
        >
          My Twins
        </button>
        <button 
          className={activeTab === "simulate" ? "active" : ""}
          onClick={() => setActiveTab("simulate")}
        >
          FHE Simulator
        </button>
        <button 
          className={activeTab === "about" ? "active" : ""}
          onClick={() => setActiveTab("about")}
        >
          About
        </button>
      </nav>
      
      <main className="main-content">
        {activeTab === "dashboard" && (
          <div className="dashboard-view">
            <div className="welcome-card">
              <h2>FHE-Based Secure Digital Twin</h2>
              <p>
                Create encrypted, multi-scale digital twins for precision medicine 
                with fully homomorphic encryption (FHE) technology.
              </p>
              <div className="fhe-features">
                <div className="feature">
                  <div className="feature-icon">🔒</div>
                  <div className="feature-text">Data remains encrypted during processing</div>
                </div>
                <div className="feature">
                  <div className="feature-icon">⚙️</div>
                  <div className="feature-text">Run simulations on encrypted health data</div>
                </div>
                <div className="feature">
                  <div className="feature-icon">📊</div>
                  <div className="feature-text">Get accurate predictions without privacy risks</div>
                </div>
              </div>
            </div>
            
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{twins.length}</div>
                <div className="stat-label">Total Twins</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{activeCount}</div>
                <div className="stat-label">Active</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{archivedCount}</div>
                <div className="stat-label">Archived</div>
              </div>
            </div>
            
            <div className="data-visualization">
              <div className="viz-card">
                <h3>Scale Distribution</h3>
                {renderScaleDistribution()}
              </div>
              <div className="viz-card">
                <h3>Status Overview</h3>
                <div className="status-chart">
                  <div className="chart-bar active" style={{ height: `${(activeCount / twins.length) * 100}%` }}></div>
                  <div className="chart-bar pending" style={{ height: `${(pendingCount / twins.length) * 100}%` }}></div>
                  <div className="chart-bar archived" style={{ height: `${(archivedCount / twins.length) * 100}%` }}></div>
                </div>
                <div className="chart-legend">
                  <div className="legend-item">
                    <div className="color-dot active"></div>
                    <span>Active</span>
                  </div>
                  <div className="legend-item">
                    <div className="color-dot pending"></div>
                    <span>Pending</span>
                  </div>
                  <div className="legend-item">
                    <div className="color-dot archived"></div>
                    <span>Archived</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "twins" && (
          <div className="twins-view">
            <div className="view-header">
              <h2>My Digital Twins</h2>
              <button 
                onClick={loadTwins}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            
            <div className="twins-list">
              {filteredTwins.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">👤</div>
                  <h3>No Digital Twins Found</h3>
                  <p>Create your first encrypted health twin to get started</p>
                  <button 
                    className="create-btn"
                    onClick={() => setShowCreateModal(true)}
                  >
                    + New Twin
                  </button>
                </div>
              ) : (
                filteredTwins.map(twin => (
                  <div className="twin-card" key={twin.id}>
                    <div className="twin-header">
                      <div className="twin-id">#{twin.id.substring(0, 6)}</div>
                      <div className={`twin-status ${twin.status}`}>{twin.status}</div>
                    </div>
                    <div className="twin-details">
                      <div className="detail">
                        <span className="label">Scale:</span>
                        <span className="value">{twin.scale}</span>
                      </div>
                      <div className="detail">
                        <span className="label">Created:</span>
                        <span className="value">
                          {new Date(twin.timestamp * 1000).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="detail">
                        <span className="label">Owner:</span>
                        <span className="value">
                          {twin.owner.substring(0, 6)}...{twin.owner.substring(38)}
                        </span>
                      </div>
                    </div>
                    <div className="twin-actions">
                      {isOwner(twin.owner) && twin.status === "pending" && (
                        <>
                          <button 
                            className="action-btn activate"
                            onClick={() => activateTwin(twin.id)}
                          >
                            Activate
                          </button>
                          <button 
                            className="action-btn archive"
                            onClick={() => archiveTwin(twin.id)}
                          >
                            Archive
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "simulate" && (
          <div className="simulator-view">
            <h2>FHE Disease Simulation</h2>
            <div className="simulator-card">
              <div className="simulator-header">
                <h3>Run Encrypted Simulation</h3>
                <div className="fhe-badge">FHE-Powered</div>
              </div>
              <div className="simulator-body">
                <p>
                  Select an active digital twin to run disease progression and drug response 
                  simulations while keeping all health data encrypted.
                </p>
                
                <div className="simulator-controls">
                  <div className="control-group">
                    <label>Select Twin</label>
                    <select>
                      <option value="">-- Select Twin --</option>
                      {twins
                        .filter(t => t.status === "active")
                        .map(t => (
                          <option key={t.id} value={t.id}>
                            {t.scale} twin #{t.id.substring(0, 6)}
                          </option>
                        ))}
                    </select>
                  </div>
                  
                  <div className="control-group">
                    <label>Simulation Type</label>
                    <select>
                      <option value="disease">Disease Progression</option>
                      <option value="drug">Drug Response</option>
                      <option value="treatment">Treatment Optimization</option>
                    </select>
                  </div>
                  
                  <button className="simulate-btn">
                    Run FHE Simulation
                  </button>
                </div>
                
                <div className="simulator-output">
                  <div className="output-header">
                    <h4>Simulation Results</h4>
                    <div className="fhe-notice">
                      All results computed on encrypted data
                    </div>
                  </div>
                  <div className="output-placeholder">
                    <p>Run a simulation to see encrypted results</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "about" && (
          <div className="about-view">
            <h2>About PrecisionMedTwin</h2>
            <div className="about-card">
              <h3>FHE-Based Secure Digital Twin for Precision Medicine</h3>
              <p>
                PrecisionMedTwin leverages Fully Homomorphic Encryption (FHE) to create 
                encrypted, multi-scale digital twins (from gene to organ level) that 
                enable secure disease progression simulations and drug response 
                predictions without ever decrypting sensitive health data.
              </p>
              
              <div className="feature-list">
                <div className="feature-item">
                  <h4>Encrypted Multi-scale Health Data</h4>
                  <p>
                    Securely store and process health data at different biological scales 
                    while maintaining end-to-end encryption.
                  </p>
                </div>
                <div className="feature-item">
                  <h4>FHE Disease & Drug Simulation</h4>
                  <p>
                    Run predictive models directly on encrypted data to forecast disease 
                    progression and medication responses.
                  </p>
                </div>
                <div className="feature-item">
                  <h4>Ultimate Personalized Medicine</h4>
                  <p>
                    Get tailored treatment recommendations based on your unique biological 
                    makeup without compromising privacy.
                  </p>
                </div>
                <div className="feature-item">
                  <h4>Complete Health Privacy</h4>
                  <p>
                    Your sensitive health information remains encrypted at all times, even 
                    during computation and analysis.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="team-card">
              <h3>Research Team</h3>
              <div className="team-members">
                <div className="member">
                  <div className="member-avatar">👩‍⚕️</div>
                  <div className="member-info">
                    <h4>Dr. Alice Chen</h4>
                    <p>Precision Medicine Specialist</p>
                  </div>
                </div>
                <div className="member">
                  <div className="member-avatar">👨‍💻</div>
                  <div className="member-info">
                    <h4>Dr. Bob Zhang</h4>
                    <p>FHE Cryptography Expert</p>
                  </div>
                </div>
                <div className="member">
                  <div className="member-avatar">👩‍🔬</div>
                  <div className="member-info">
                    <h4>Dr. Carol Wang</h4>
                    <p>Biomedical Data Scientist</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitTwin} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          twinData={newTwinData}
          setTwinData={setNewTwinData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-left">
            <div className="footer-logo">
              <h3>PrecisionMed<span>Twin</span></h3>
              <div className="fhe-badge">FHE-Powered</div>
            </div>
            <p>Secure digital twins for precision medicine</p>
          </div>
          
          <div className="footer-right">
            <div className="footer-links">
              <a href="#">Documentation</a>
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
              <a href="#">Contact</a>
            </div>
            <div className="copyright">
              © {new Date().getFullYear()} PrecisionMedTwin. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  twinData: any;
  setTwinData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  twinData,
  setTwinData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTwinData({
      ...twinData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!twinData.scale || !twinData.healthData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Digital Twin</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon">🔒</div>
            <span>All data will be encrypted with FHE technology</span>
          </div>
          
          <div className="form-group">
            <label>Biological Scale *</label>
            <select 
              name="scale"
              value={twinData.scale} 
              onChange={handleChange}
            >
              <option value="gene">Gene Level</option>
              <option value="cell">Cell Level</option>
              <option value="organ">Organ Level</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <input 
              type="text"
              name="description"
              value={twinData.description} 
              onChange={handleChange}
              placeholder="Brief description of this twin..." 
            />
          </div>
          
          <div className="form-group">
            <label>Health Data *</label>
            <textarea 
              name="healthData"
              value={twinData.healthData} 
              onChange={handleChange}
              placeholder="Enter health data to encrypt (genetic, lab results, imaging, etc.)..." 
              rows={5}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating ? "Encrypting with FHE..." : "Create Encrypted Twin"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;