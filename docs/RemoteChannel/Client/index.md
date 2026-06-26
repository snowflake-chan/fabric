# C-🔊 游戏跨端通讯

**ClientRemoteChannel** 是游戏中管理客户端与服务端通信的核心接口，它提供了以下功能：

- 事件通信：实现客户端与服务端之间的事件传递和监听
- 数据传输：支持跨端数据的安全传输和处理
- 状态同步：确保客户端和服务端之间的状态一致性

你可以通过全局对象 `remoteChannel` 来使用这些功能。

## 类定义

```typescript
declare const remoteChannel: ClientRemoteChannel;
declare class ClientRemoteChannel {
  //...
}
```

## 方法列表

### 通信方法

- [`sendServerEvent`](/RemoteChannel/Client/serverToClient#sendServerEvent) : 向服务端发送自定义事件

### 事件监听

- [`onClientEvent`](/RemoteChannel/Client/clientToServer#onClientEvent) : 监听来自服务端的事件
