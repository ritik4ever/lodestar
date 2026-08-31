# x402 primer

x402 is a lightweight payment protocol for HTTP APIs. A client makes a normal request, receives a `402 Payment Required` response, and then proves it has paid by sending a signed payment transaction back in the request headers. The service can then retry the original request and return the protected content.

For newcomers, the easiest way to think about it is:

- the client asks for a resource;
- the server says “this costs money”;
- the client proves payment with a Stellar transaction;
- the server completes the request.

## How the 402 flow works

A concrete trace looks like this:

1. An agent calls an endpoint such as `/weather`.
2. The service responds with `402 Payment Required` and an `WWW-Authenticate` challenge that describes the payment requirement.
3. The agent uses a facilitator to build a signed payment transaction for the required amount and recipient.
4. The agent retries the same request with the payment headers, including the payment address and the transaction hash.
5. The service validates the payment and returns the data.

In short, the request/response pattern is:

```text
Client -> GET /weather
Server -> 402 Payment Required + challenge
Client -> GET /weather with payment headers
Server -> 200 OK + protected response
```

## What the facilitator does

The facilitator is the payment broker that helps the client complete the challenge. It does not replace the service provider, and it does not hold the funds permanently. Instead, it helps construct and, in many cases, submit the payment transaction so the client can satisfy the server's payment requirement.

In this project, the backend exposes a facilitator URL and uses it during the demo payment flow. That keeps the client-side logic simple: the agent asks for a payment challenge, the facilitator prepares the payment proof, and the service validates it.

## Where Stellar fits

The payment proof is a Stellar transaction. The service provider can choose where the funds should go, and the wire-up for the payment is encoded in the transaction details. Once the transaction is accepted on the network, the server can treat the payment as complete and serve the protected resource.

That is why x402 is a good fit for this project: it lets an agent pay for a resource over standard HTTP while using Stellar as the settlement layer.

## Why this matters in Lodestar

Lodestar uses x402 as the payment layer for discoverable services. A service provider publishes an endpoint and a price. An agent discovers that endpoint, hits it, satisfies the payment challenge, and receives the data. The result is a simple path from discovery to payment without hardcoded service URLs.

## References

- Upstream x402 specification: https://github.com/coinbase/x402
- Stellar documentation: https://developers.stellar.org/
