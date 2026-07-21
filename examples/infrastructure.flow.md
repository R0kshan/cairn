# TECHNICAL FLOW MATRIX — Billing platform — infrastructure view

| No. | Source | Destination | Protocol | Port | Flow |
|---|---|---|---|---|---|
| 1 | User workstations | WAF (DMZ) | HTTPS | 443 | Web application access |
| 2 | WAF (DMZ) | Gateway (Application zone) | HTTPS | 443 | Route to backend |
| 3 | Gateway (Application zone) | OAuth2 proxy (Application zone) | HTTP | 80 | Verify tokens |
| 4 | OAuth2 proxy (Application zone) | LDAP / IdP (Application zone) | LDAPS | 636 | Validate identity |
| 5 | Gateway (Application zone) | Billing (Application zone) | HTTPS | 8443 | Billing API |
| 6 | Gateway (Application zone) | CRM (Application zone) | HTTPS | 8444 | CRM API |
| 7 | Billing (Application zone) | PostgreSQL (Data zone) | TCP | 5432 | Read/write billing data |
| 8 | CRM (Application zone) | PostgreSQL (Data zone) | TCP | 5432 | Read/write customer data |
| 9 | Billing (Application zone) | Message broker (Application zone) | TCP | 9092 | Publish billing events |
| 10 | Message broker (Application zone) | CRM (Application zone) | TCP | 9092 | Consume billing events |
| 11 | Billing (Application zone) | Transfer gateway (DMZ) | SFTP | 22 | Drop invoices to transmit |
| 12 | Transfer gateway (DMZ) | Partner EDI platform | AS4 | 443 | Partner transfers |
| 13 | Database server (Data zone) | Backup server (Data zone) | TCP | 9092 | Daily backups |
