# TECHNICAL FLOW MATRIX — Billing platform — security view

| No. | Source | Destination | Protocol | Flow |
|---|---|---|---|---|
| 1 | End users | WAF / reverse proxy (DMZ) | TLS1.3 | Web access |
| 2 | WAF / reverse proxy (DMZ) | Billing application (Application zone) | mTLS | Filtered billing traffic |
| 3 | WAF / reverse proxy (DMZ) | CRM application (Application zone) | mTLS | Filtered CRM traffic |
| 4 | Billing application (Application zone) | Database firewall (Data zone) | TLS1.3 | Billing data access |
| 5 | CRM application (Application zone) | Database firewall (Data zone) | TLS1.3 | Customer data access |
| 6 | Database firewall (Data zone) | Customer & billing database (Data zone) | TLS1.3 | Screened queries |
| 7 | Billing application (Application zone) | SFTP gateway (DMZ) | TLS1.3 | Drop invoices to transmit |
| 8 | SFTP gateway (DMZ) | Partner EDI platform | AS4 | Partner transfer |
