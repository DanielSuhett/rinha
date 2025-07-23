# Minha versão da rinha de backends em NestJS

## Stack
- NodeJS (Runtime)
- NestJS (Framework)
- Typescript (Superset)
- Fastify (HTTP Server)
- Redis (Queue & Storage)
- Nginx Load Balancer


## Estratégia
A aplicação tem duas instâncias, que tem cada uma delas uma fila para processar os itens que o load balancer endereça.
O consumo passa por uma camada intermediária que consulta um pseudo circuit breaker que retorna uma cor

* GREEN: Usa o processor default
* YELLOW: Usa o processor fallback
* RED: Recoloca no **começo** da fila.

Recebendo uma cor, ele tentará executar o pagamento no processor definido.

**Sucesso?** Grava o pagamento no mesmo redis que utilizamos para a queue.
**Falha?** Convocamos um método chamado signal, esse método vai chamar o health do processor diferente do que foi tentado.
Se o health retornar ok em até 500ms, encontramos uma nova cor, definimos, retornamos para o signal reenviar o request.
Caso os dois estejam off abre-se uma recursão a cada 5000ms para validar ambos os health.
Caso alguém tente consultar uma cor ou enviar um signal enquanto a recursão acontece, a cor retornada é vermelha e os itens voltam para a fila.

## Limites de Recursos

```yaml
Total permitido: 1.5 CPU + 350MB RAM

Distribuição:
- nginx: 0.10 CPU + 55MB
- api1: 0.60 CPU + 70MB
- api2: 0.60 CPU + 70MB
- redis: 0.20 CPU + 150MB
```

## Configuração e Deploy

### Pré-requisitos
- Docker e Docker Compose
- Network `payment-processor` disponível

### Executar localmente
```bash
docker-compose up --build

# Testar endpoints
curl -X POST http://localhost:9999/payments \
  -H "Content-Type: application/json" \
  -d '{"correlationId": "123e4567-e89b-12d3-a456-426614174000", "amount": 19.90}'

curl http://localhost:9999/payments-summary
```

## Variáveis de Ambiente

```env
APP_PORT=8080
APP_MODE=1
REDIS_HOST=redis
REDIS_PORT=6379
PROCESSOR_DEFAULT_URL=http://payment-processor-default:8080
PROCESSOR_FALLBACK_URL=http://payment-processor-fallback:8080
```
