import LocalMessaging from "../../local-messaging";
import PlayerLocalStorage from "../../player-local-storage";

describe("PlayerLocalStorage", () => {
  let playerLocalStorage = null;
  let localMessaging = null;
  let eventHandler = null;

  function mockViewerLocalMessaging(connected) {
    top.RiseVision = {};
    top.RiseVision.Viewer = {};
    top.RiseVision.Viewer.LocalMessaging = {
      canConnect: () => {return connected;}
    };

    top.RiseVision.Viewer.LocalMessaging.write = jest.genMockFn();
    top.RiseVision.Viewer.LocalMessaging.receiveMessages = jest.genMockFn();
  }

  beforeEach(() => {
    mockViewerLocalMessaging(true);
    eventHandler = jest.genMockFn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should execute no-connection event on event handler when no LM client connection", ()=> {
      mockViewerLocalMessaging(false);

      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      expect(eventHandler).toHaveBeenCalledWith({
        "event": "no-connection"
      })
    });

    it("should send client list request when LM client connection", ()=> {
      mockViewerLocalMessaging(true);

      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      expect(eventHandler).toHaveBeenCalledTimes(0);
      expect(top.RiseVision.Viewer.LocalMessaging.write).toHaveBeenCalledWith({
        "topic": "client-list-request"
      });
    });
  });

  describe("_handleMessage()", () => {

    beforeEach(() => {
      jest.useFakeTimers();
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);
    });

    afterEach(() => {
      jest.clearAllTimers();
    });

    describe("CLIENT-LIST", () => {
      it("should start licensing request(s) when required modules are present", () => {
        const message = {
          "topic": "client-list",
          "clients": ["local-messaging", "player-electron", "local-storage", "licensing", "logger"]
        };

        const spy = jest.spyOn(playerLocalStorage, "_startLicensingRequestTimer");

        playerLocalStorage._handleMessage(message);

        expect(spy).toHaveBeenCalled();
        spy.mockReset();
        spy.mockRestore();
      });

      it("should send CLIENT-LIST-REQUEST 30 more times every 1 second before executing required-modules-unavailable event on event handler", () => {
        const message = {
          "topic": "client-list",
          "clients": ["local-messaging", "player-electron", "logger"]
        };

        top.RiseVision.Viewer.LocalMessaging.write.mockClear();
        playerLocalStorage._handleMessage(message);
        jest.advanceTimersByTime(1000);
        expect(eventHandler).toHaveBeenCalledTimes(0);
        expect(top.RiseVision.Viewer.LocalMessaging.write).toHaveBeenCalledWith({
          "topic": "client-list-request"
        });

        // mock 30 more client-list messages sent/received
        for (let i = 30; i > 0; i--){
          playerLocalStorage._handleMessage(message);
          jest.advanceTimersByTime(1000);
        }

        expect(eventHandler).toHaveBeenCalledWith({
          "event": "required-modules-unavailable"
        })
      });
    });

    describe("STORAGE-LICENSING-UPDATE", () => {
      beforeEach(()=>{
        eventHandler.mockClear();
      });

      it("should send STORAGE-LICENSING-REQUEST 30 more times every 1 second before executing licensing-unavailable event on event handler", () => {
        const message = {
          "topic": "client-list",
          "clients": ["local-messaging", "player-electron", "local-storage", "licensing", "logger"]
        };

        top.RiseVision.Viewer.LocalMessaging.write.mockClear();
        playerLocalStorage._handleMessage(message);

        jest.advanceTimersByTime(1000);

        expect(eventHandler).toHaveBeenCalledTimes(0);
        expect(top.RiseVision.Viewer.LocalMessaging.write).toHaveBeenCalledWith({
          "topic": "storage-licensing-request"
        });

        jest.advanceTimersByTime(30000);

        expect(eventHandler).toHaveBeenCalledWith({
          "event": "licensing-unavailable"
        })
      });

      it("should update authorization and execute 'licensing' event on event handler", () => {
        const message = {
          "from": "storage-module",
          "topic": "storage-licensing-update",
          "isAuthorized": false,
          "userFriendlyStatus": "unauthorized"
        };

        const spy = jest.spyOn(playerLocalStorage, "_clearLicensingRequestTimer");

        playerLocalStorage._handleMessage(message);

        // should clear the request timer
        expect(spy).toHaveBeenCalled();
        spy.mockReset();
        spy.mockRestore();

        expect(playerLocalStorage.isAuthorized()).toBeFalsy();
        expect(eventHandler).toHaveBeenCalledWith({
          "event": "unauthorized"
        });

        message.isAuthorized = true;
        message.userFriendlyStatus = "authorized";
        eventHandler.mockClear();

        playerLocalStorage._handleMessage(message);

        expect(playerLocalStorage.isAuthorized()).toBeTruthy();
        expect(eventHandler).toHaveBeenCalledWith({
          "event": "authorized"
        });
      });

      it("should not update authorization or execute event on handler if authorization hasn't changed", () => {
        const message = {
          "from": "storage-module",
          "topic": "storage-licensing-update",
          "isAuthorized": true,
          "userFriendlyStatus": "authorized"
        };

        expect(playerLocalStorage.isAuthorized()).toBeNull();

        playerLocalStorage._handleMessage(message);

        expect(playerLocalStorage.isAuthorized()).toBeTruthy();
        expect(eventHandler).toHaveBeenCalledTimes(1);

        playerLocalStorage._handleMessage(message);
        expect(playerLocalStorage.isAuthorized()).toBeTruthy();
        expect(eventHandler).toHaveBeenCalledTimes(1);

      });
    });

    describe("FILE-UPDATE", () => {
      beforeEach(()=>{
        const message = {
          "from": "storage-module",
          "topic": "storage-licensing-update",
          "isAuthorized": true,
          "userFriendlyStatus": "authorized"
        };

        playerLocalStorage._handleMessage(message);
        eventHandler.mockClear();
      });

      it("should not execute if 'message' does not contain required props", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update"
        };

        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);

        message.filePath = "test.png";

        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);

        message.status = "noexist";

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(1);

      });

      it("should not execute if message pertains to a file not being watched", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "non-watched-file.png",
          "status": "stale"
        };

        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });

      it("should execute 'file-available' event on event handler when message status is CURRENT", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test.png",
          "status": "current",
          "ospath": "rvplayer/modules/local-storage/xxxx/cache/ABC123",
          "osurl": "file:///rvplayer/modules/local-storage/xxxx/cache/ABC123"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-available",
          filePath: message.filePath,
          fileUrl: message.osurl
        });
      });

      it("should not execute any event on event handler when watched file status is same as new status", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test.png",
          "status": "current",
          "ospath": "rvplayer/modules/local-storage/xxxx/cache/ABC123",
          "osurl": "rvplayer/modules/local-storage/xxxx/cache/ABC123"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(1);

        eventHandler.mockClear();

        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });

      it("should execute 'file-processing' event on event handler when status is STALE", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test.png",
          "status": "stale"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-processing",
          filePath: "test.png"
        });
      });

      it("should execute 'storage-file-no-exist' event on event handler when status is NOEXIST", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test.png",
          "status": "noexist"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-no-exist",
          filePath: "test.png"
        });
      });

      it("should execute 'storage-file-deleted' event on event handler when status is DELETED", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-update",
          "filePath": "test.png",
          "status": "deleted"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-deleted",
          filePath: "test.png"
        });
      });
    });

    describe("FILE-ERROR", () => {
      beforeEach(()=>{
        const message = {
          "from": "storage-module",
          "topic": "storage-licensing-update",
          "isAuthorized": true,
          "userFriendlyStatus": "authorized"
        };

        playerLocalStorage._handleMessage(message);
        eventHandler.mockClear();
      });

      it("should not execute if 'message' does not contain filePath prop", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-error"
        };

        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });

      it("should not execute if message pertains to a file not being watched", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-error",
          "filePath": "non-watched-file.png",
          "msg": "Insufficient disk space"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledTimes(0);
      });

      it("should execute 'storage-file-error' event on event handler", () => {
        const message = {
          "from": "storage-module",
          "topic": "file-error",
          "filePath": "test.png",
          "msg": "Could not retrieve signed URL",
          "detail": "Some response details"
        };

        playerLocalStorage.watchFiles("test.png");
        playerLocalStorage._handleMessage(message);
        expect(eventHandler).toHaveBeenCalledWith({
          event: "file-error",
          filePath: message.filePath,
          msg: message.msg,
          detail: message.detail
        });
      });
    });
  });

  describe("_watchFile", () => {
    beforeEach(()=>{
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const message = {
        "from": "storage-module",
        "topic": "storage-licensing-update",
        "isAuthorized": true,
        "userFriendlyStatus": "authorized"
      };
      playerLocalStorage._handleMessage(message);
    });

    it("should broadcast WATCH of single file", () => {
      playerLocalStorage._watchFile("test.png");

      expect(top.RiseVision.Viewer.LocalMessaging.write).toHaveBeenCalledWith({
        "topic": "WATCH",
        "filePath": "test.png"
      });
    });
  });

  describe("watchFiles()", () => {

    it("should not execute if not connected", () => {
      mockViewerLocalMessaging(false);
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const spy = jest.spyOn(playerLocalStorage, '_watchFile');

      playerLocalStorage.watchFiles(["test1.png", "test2.png"]);

      expect(spy).toHaveBeenCalledTimes(0);

      spy.mockReset();
      spy.mockRestore();
    });

    it("should not execute if not authorized", () => {
      mockViewerLocalMessaging(true);
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const message = {
        "from": "storage-module",
        "topic": "storage-licensing-update",
        "isAuthorized": false,
        "userFriendlyStatus": "unauthorized"
      };

      const spy = jest.spyOn(playerLocalStorage, '_watchFile');

      playerLocalStorage._handleMessage(message);

      playerLocalStorage.watchFiles(["test1.png", "test2.png"]);

      expect(spy).toHaveBeenCalledTimes(0);

      spy.mockReset();
      spy.mockRestore();
    });

    it("should watch one single file provided as a param string", () => {
      localMessaging = new LocalMessaging();
      playerLocalStorage = new PlayerLocalStorage(localMessaging, eventHandler);

      const message = {
        "from": "storage-module",
        "topic": "storage-licensing-update",
        "isAuthorized": true,
        "userFriendlyStatus": "authorized"
      };

      const spy = jest.spyOn(playerLocalStorage, '_watchFile');

      playerLocalStorage._handleMessage(message);
      playerLocalStorage.watchFiles("test.png");

      expect(spy).toHaveBeenCalledWith("test.png");

      spy.mockReset();
      spy.mockRestore();
    });

    it("should start watching multiple single files", () => {
      const spy = jest.spyOn(playerLocalStorage, '_watchFile');

      playerLocalStorage.watchFiles(["test1.png", "test2.png"]);

      expect(spy).toHaveBeenCalledTimes(2);

      spy.mockReset();
      spy.mockRestore();
    });

    it("should only send watch of single files that aren't already being watched", () => {
      const spy = jest.spyOn(playerLocalStorage, '_watchFile');

      playerLocalStorage.watchFiles(["test.png", "test1.png", "test2.png", "test3.png"]);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("test3.png");

      spy.mockReset();
      spy.mockRestore();
    });
  });

});
