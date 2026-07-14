# TECHNICAL FLOW MATRIX — Billing platform — infrastructure view

| No. | Source | Destination | Protocol | Port | Flow |
|---|---|---|---|---|---|
| 1 | User workstations | WAF (DMZ) | HTTPS | 443 | Web application access |
| 2 | WAF (DMZ) | Billing (Application zone) | HTTPS | 8443 | Filtered billing traffic |
| 3 | WAF (DMZ) | CRM (Application zone) | HTTPS | 8444 | Filtered CRM traffic |
| 4 | Billing (Application zone) | PostgreSQL (Data zone) | TCP | 5432 | Read/write billing data |
| 5 | CRM (Application zone) | PostgreSQL (Data zone) | TCP | 5432 | Read/write customer data |
| 6 | Billing (Application zone) | Transfer gateway (DMZ) | SFTP | 22 | Drop invoices to transmit |
| 7 | Transfer gateway (DMZ) | Partner EDI platform | AS4 | 443 | Partner transfers |
| 8 | Database server (Data zone) | Backup server (Data zone) | TCP | 9092 | Daily backups |
