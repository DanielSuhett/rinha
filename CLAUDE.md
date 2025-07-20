<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" class="logo" width="120"/>

# CLAUDE.md

## Context: Backend Performance Challenge (Rinha de Backend 2025)

### Challenge Overview

I'm participating in the **Rinha de Backend 2025** performance challenge. The goal is to develop a high-performance backend that intermediates payment processing requests to two Payment Processor services while maximizing profit through optimal routing strategies.

### System Architecture

```
Client Request → My Backend → Payment Processor (Default/Fallback)
```

#### Payment Processors

1. **Payment Processor Default**: Lower fees, primary option
2. **Payment Processor Fallback**: Higher fees, contingency option

Both services can become unstable (high response times, HTTP 500 errors) or completely unavailable simultaneously.

### Key Requirements

#### Endpoints to Implement

1. **POST /payments** - Process payment requests

```json
Request: {
  "correlationId": "uuid",
  "amount": 19.90
}
Response: HTTP 2XX (any content)
```

2. **GET /payments-summary** - Return payment processing summary

```json
Response: {
  "default": {
    "totalRequests": 43236,
    "totalAmount": 415542345.98
  },
  "fallback": {
    "totalRequests": 423545,
    "totalAmount": 329347.34
  }
}
```

#### Payment Processor Integration

- **Default**: `http://payment-processor-default:8080`
- **Fallback**: `http://payment-processor-fallback:8080`

#### Available Payment Processor Endpoints

- **POST /payments** - Process payment
- **GET /payments/service-health** - Check service status (1 call per 5 seconds limit)
- **GET /payments/{id}** - Get payment details
- **GET /admin/payments-summary** - Administrative summary

### Technical Constraints

#### Architecture Requirements

- **Minimum 2 web server instances** with load balancing
- **Docker Compose deployment** with public images
- **Resource Limits**: 1.5 CPU units + 350MB RAM total
- **Port 9999**: All endpoints exposed on `http://localhost:9999`
- **Network**: Bridge mode, payment-processor network integration

#### Performance Optimization

- **Scoring**: Based on profit maximization (lower fees = higher profit)
- **Penalty**: 35% fine on total profit for consistency errors
- **Performance Bonus**: 2% bonus per ms below 11ms p99 response time
  - Formula: `(11 - p99) * 0.02`
  - Examples: 10ms = 2%, 9ms = 4%, 5ms = 12%, 1ms = 20%

### Strategy Considerations

#### Optimal Payment Routing

1. **Health Check Management**: Use service-health endpoints (rate-limited to 1/5s)
2. **Fallback Strategy**: Switch to fallback when default fails/slow
3. **Circuit Breaker Pattern**: Avoid cascading failures
4. **Consistency Maintenance**: Ensure payment summaries match between services

#### Performance Targets

- **Primary Goal**: Maximize successful payments with lowest fees
- **Secondary Goal**: Achieve sub-11ms p99 response times
- **Critical**: Maintain data consistency to avoid 35% penalty

### Development Focus Areas

1. **Load Balancing**: Efficient request distribution
2. **Circuit Breakers**: Smart failover mechanisms
3. **Health Monitoring**: Strategic use of health-check endpoints
4. **Data Consistency**: Accurate payment tracking and reporting
5. **Performance Optimization**: Sub-11ms p99 response times
6. **Resource Management**: Stay within CPU/memory limits

### Submission Requirements

- Public Docker images compatible with linux-amd64
- Complete docker-compose.yml with resource limits
- Network integration with payment-processor services
- Deadline: **August 17, 2025 23:59:59**

This challenge tests both system design skills and performance optimization under resource constraints while dealing with unreliable external services.

You can track result of last changes on

/home/danielsuhett/Developer/rinha-de-backend-2025/rinha-test/partial-results.json

and see the k6 scrtipt on

/home/danielsuhett/Developer/rinha-de-backend-2025/rinha-test/rinha.js

you can see the logs of containers at

docker logs rinha-api1-1 --tail 200 or docker logs rinha-api2-1 --tail 200
