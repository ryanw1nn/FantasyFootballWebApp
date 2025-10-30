# Network Intrusion Detection System (IDS)

A Python-based Network Intrusion Detection System that monitors network traffic in real-time to detect potential security threats using both signature-based and anomaly-based detection methods.

## Features

- **Real-time Packet Capture**: Monitors network interfaces for TCP/IP traffic
- **Dual Detection Methods**:
  - **Signature-based**: Detects known attack patterns (SYN floods, port scans)
  - **Anomaly-based**: Uses machine learning (Isolation Forest) to identify unusual traffic
- **Flow Tracking**: Maintains statistics for individual network flows
- **Alert System**: Logs threats to file with JSON formatting
- **Comprehensive Testing**: Unit tests and live network testing capabilities
- **Extensible Architecture**: Easy to add custom detection rules

## Architecture

```
┌─────────────────┐
│ Packet Capture  │ ──> Captures TCP/IP packets from network interface
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│Traffic Analyzer │ ──> Extracts features and tracks flow statistics
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│Detection Engine │ ──> Applies signature rules and anomaly detection
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Alert System   │ ──> Logs and notifies about detected threats
└─────────────────┘
```

## Installation

### Prerequisites

- Python 3.8 or higher
- Root/sudo access (required for packet capture)

### Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd IDS_project
   ```

2. **Create virtual environment**:
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

### Dependencies

```
scapy>=2.5.0
scikit-learn>=1.3.0
numpy>=1.24.0
```

## Usage

### Running the IDS

**Basic usage (monitors loopback interface)**:
```bash
sudo python3 -m ids.intrusion_detection_system
```

**Monitor specific interface**:
```bash
sudo python3 -m ids.intrusion_detection_system -i en0
```

**Find your network interface**:
```bash
# macOS/BSD
ifconfig

# Linux
ip link show
```

Common interfaces:
- `lo0` / `lo` - Loopback (local traffic)
- `eth0` - Ethernet (Linux)
- `en0` / `en1` - WiFi/Ethernet (macOS)
- `wlan0` - WiFi (Linux)

### Running Tests

**Unit tests**:
```bash
python -m tests.test_ids
```

**PCAP file test** (generates synthetic attack traffic):
```bash
python -m tests.test_ids --pcap
```

**Live network test**:
```bash
sudo python3 -m tests.test_ids --live en0
```

### Viewing Alerts

Alerts are logged to `ids_alerts.log` in JSON format:

```bash
cat ids_alerts.log
```

Example alert:
```json
{
  "timestamp": "2025-10-27T12:34:56.789",
  "threat_type": "signature",
  "rule": "syn_flood",
  "severity": "high",
  "confidence": 1.0,
  "source_ip": "10.0.0.1",
  "source_port": 5678,
  "destination_ip": "192.168.1.2",
  "destination_port": 80,
  "description": "Potential SYN flood attack detected"
}
```

## Detection Methods

### Signature-Based Detection

Detects known attack patterns:

1. **SYN Flood**: High rate of SYN packets without ACK responses
   - Threshold: >100 packets/second
   - Packet size: <100 bytes
   - Severity: High

2. **Port Scan**: Sequential connection attempts to multiple ports
   - Threshold: >20 packets/second
   - Flow duration: <2 seconds
   - Severity: Medium

3. **Large Packet**: Packets exceeding typical MTU size
   - Threshold: >1500 bytes
   - Severity: Low

### Anomaly-Based Detection

Uses Isolation Forest algorithm to detect unusual traffic patterns:
- Learns baseline from normal traffic
- Identifies statistical outliers
- Features: packet size, packet rate, byte rate

## Project Structure

```
IDS_project/
├── ids/
│   ├── __init__.py
│   ├── intrusion_detection_system.py  # Main IDS orchestration
│   ├── packet_capture.py              # Network packet capture
│   ├── traffic_analyzer.py            # Flow tracking & feature extraction
│   ├── detection_engine.py            # Threat detection logic
│   └── alert_system.py                # Alert logging & notification
├── tests/
│   └── test_ids.py                    # Comprehensive test suite
├── requirements.txt
├── README.md
└── ids_alerts.log                     # Generated alert log
```

## Configuration

### Customizing Detection Rules

Add custom signature rules:

```python
from ids.detection_engine import DetectionEngine

engine = DetectionEngine()

# Add custom rule
engine.add_signature_rule(
    name='custom_rule',
    condition=lambda features: features['packet_rate'] > 500,
    severity='high',
    description='Custom high-rate detection'
)
```

### Adjusting Parameters

Key parameters can be modified during initialization:

```python
from ids.intrusion_detection_system import IntrusionDetectionSystem
from ids.traffic_analyzer import TrafficAnalyzer
from ids.packet_capture import PacketCapture

# Custom configuration
ids = IntrusionDetectionSystem(interface='en0')
ids.traffic_analyzer = TrafficAnalyzer(max_flows=5000, flow_timeout=600)
ids.packet_capture = PacketCapture(queue_size=2000)
```

## Performance Considerations

- **Queue Size**: Default 1000 packets - increase for high-traffic networks
- **Max Flows**: Default 10,000 - adjust based on network size
- **Flow Timeout**: Default 300s - shorter for high-churn environments
- **Memory Usage**: ~100MB baseline + ~1KB per tracked flow

## Limitations

- **TCP Only**: Currently only monitors TCP traffic
- **Single Interface**: Monitors one interface at a time
- **No Payload Inspection**: Only analyzes packet headers
- **Real-time Only**: Does not support offline PCAP analysis in production mode

## Troubleshooting

### Permission Denied
```bash
# Solution: Run with sudo
sudo python3 -m ids.intrusion_detection_system
```

### No Packets Captured
- Verify interface name: `ifconfig` or `ip link show`
- Check interface is up and has traffic
- Try loopback (`lo0`/`lo`) with local traffic

### High False Positive Rate
- Anomaly detection may need better training data
- Adjust signature rule thresholds in `detection_engine.py`
- Consider disabling anomaly detection for production use


## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Submit a pull request


## Authors

Ryan Winn

## Acknowledgments

- Built with Scapy for packet capture
- Uses scikit-learn's Isolation Forest for anomaly detection
- Inspired by traditional IDS systems like Snort and Suricata
