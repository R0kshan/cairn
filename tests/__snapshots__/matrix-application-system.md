# TECHNICAL FLOW MATRIX — Order platform — application view

| No. | Source | Destination | Protocol | Flow |
|---|---|---|---|---|
| 1 | Order clerk | Order capture (Order management) |  |  |
| 2 | Support agent | Customer records (Customer CRM) |  |  |
| 3 | Order capture (Order management) | Order validation (Order management) | API_REST |  |
| 4 | Order validation (Order management) | Order repository (Order platform) | JDBC |  |
| 5 | Order validation (Order management) | Order event bus (Order platform) | MQ |  |
| 6 | Invoicing (Billing) | Order event bus (Order platform) | MQ |  |
| 7 | Customer records (Customer CRM) | Order validation (Order management) | API_REST |  |
| 8 | Invoicing (Billing) | Carrier tracking (third party) | SFTP |  |
