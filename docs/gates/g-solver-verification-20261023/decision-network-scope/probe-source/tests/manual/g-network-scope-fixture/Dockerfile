FROM ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
RUN sed -i 's/^Components:.*/Components: main/' /etc/apt/sources.list.d/ubuntu.sources && apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=120 update && DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=120 install -y --no-install-recommends python3 curl iptables iproute2 util-linux libcap2-bin ca-certificates && rm -rf /var/lib/apt/lists/*
COPY service.py /fixture/service.py
