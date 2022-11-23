import { Injectable, VersioningType } from '@nestjs/common';
import { RoutePathFactory } from '@nestjs/core/router/route-path-factory';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { Controller } from '../../../common/decorators/core/controller.decorator';
import { RequestMapping } from '../../../common/decorators/http/request-mapping.decorator';
import { RequestMethod } from '../../../common/enums/request-method.enum';
import { NestMiddleware } from '../../../common/interfaces/middleware/nest-middleware.interface';
import { ApplicationConfig } from '../../application-config';
import { InvalidMiddlewareException } from '../../errors/exceptions/invalid-middleware.exception';
import { RuntimeException } from '../../errors/exceptions/runtime.exception';
import { NestContainer } from '../../injector/container';
import { InstanceWrapper } from '../../injector/instance-wrapper';
import { Module } from '../../injector/module';
import { MiddlewareBuilder } from '../../middleware/builder';
import { MiddlewareContainer } from '../../middleware/container';
import { MiddlewareModule } from '../../middleware/middleware-module';
import { RouterExceptionFilters } from '../../router/router-exception-filters';
import { NoopHttpAdapter } from '../utils/noop-adapter.spec';
import { mapToExcludeRoute } from './../../middleware/utils';

describe('MiddlewareModule', () => {
  let middlewareModule: MiddlewareModule;

  @Controller('test')
  class BasicController {}

  @Controller('test')
  class BaseController {
    @RequestMapping({ path: 'test' })
    public getTest() {}

    @RequestMapping({ path: 'another', method: RequestMethod.DELETE })
    public getAnother() {}
  }

  @Injectable()
  class TestMiddleware implements NestMiddleware {
    public use(req, res, next) {}
  }

  beforeEach(() => {
    const appConfig = new ApplicationConfig();
    middlewareModule = new MiddlewareModule(new RoutePathFactory(appConfig));
    (middlewareModule as any).routerExceptionFilter =
      new RouterExceptionFilters(
        new NestContainer(),
        appConfig,
        new NoopHttpAdapter({}),
      );
    (middlewareModule as any).config = appConfig;
  });

  describe('loadConfiguration', () => {
    it('should call "configure" method if method is implemented', async () => {
      const stubContainer = new NestContainer();
      stubContainer
        .getModules()
        .set('Test', new Module(class {}, stubContainer));

      const configureSpy = sinon.spy();
      const mockModule = {
        instance: {
          configure: configureSpy,
        },
      };

      (middlewareModule as any).container = stubContainer;
      await middlewareModule.loadConfiguration(
        new MiddlewareContainer(stubContainer),
        mockModule as any,
        'Test',
      );

      expect(configureSpy.calledOnce).to.be.true;
      expect(
        configureSpy.calledWith(
          new MiddlewareBuilder(
            (middlewareModule as any).routesMapper,
            undefined,
          ),
        ),
      ).to.be.true;
    });
  });

  describe('registerRouteMiddleware', () => {
    class TestModule {}

    let nestContainer: NestContainer;

    beforeEach(() => {
      nestContainer = new NestContainer();
      nestContainer
        .getModules()
        .set('Test', new Module(TestModule, nestContainer));
    });
    it('should throw "RuntimeException" exception when middleware is not stored in container', () => {
      const route = { path: 'Test' };
      const configuration = {
        middleware: [TestMiddleware],
        forRoutes: [BaseController],
      };
      const useSpy = sinon.spy();
      const app = { use: useSpy };

      middlewareModule['container'] = nestContainer;

      expect(
        middlewareModule.registerRouteMiddleware(
          new MiddlewareContainer(nestContainer),
          route as any,
          configuration,
          'Test',
          app,
        ),
      ).to.eventually.be.rejectedWith(RuntimeException);
    });

    it('should throw "InvalidMiddlewareException" exception when middleware does not have "use" method', () => {
      @Injectable()
      class InvalidMiddleware {}

      const route = { path: 'Test' };
      const configuration = {
        middleware: [InvalidMiddleware],
        forRoutes: [BaseController],
      };

      const useSpy = sinon.spy();
      const app = { use: useSpy };

      const container = new MiddlewareContainer(nestContainer);
      const moduleKey = 'Test';
      container.insertConfig([configuration], moduleKey);

      const instance = new InvalidMiddleware();
      container.getMiddlewareCollection(moduleKey).set('InvalidMiddleware', {
        metatype: InvalidMiddleware,
        instance,
      } as any);

      expect(
        middlewareModule.registerRouteMiddleware(
          container,
          route as any,
          configuration,
          moduleKey,
          app,
        ),
      ).to.be.rejectedWith(InvalidMiddlewareException);
    });

    it('should mount middleware when is stored in container', async () => {
      const route = 'testPath';
      const configuration = {
        middleware: [TestMiddleware],
        forRoutes: ['test', BasicController, BaseController],
      };

      const createMiddlewareFactoryStub = sinon
        .stub()
        .callsFake(() => () => null);
      const app = {
        createMiddlewareFactory: createMiddlewareFactoryStub,
      };

      const stubContainer = new NestContainer();
      stubContainer
        .getModules()
        .set('Test', new Module(TestModule, stubContainer));

      const container = new MiddlewareContainer(stubContainer);
      const moduleKey = 'Test';
      container.insertConfig([configuration], moduleKey);

      const instance = new TestMiddleware();
      container.getMiddlewareCollection(moduleKey).set(
        TestMiddleware,
        new InstanceWrapper({
          metatype: TestMiddleware,
          instance,
        }),
      );
      sinon
        .stub(stubContainer, 'getModuleByKey')
        .callsFake(() => new Module(class {}, stubContainer));
      middlewareModule['container'] = stubContainer;

      await middlewareModule.registerRouteMiddleware(
        container,
        { path: route, method: RequestMethod.ALL },
        configuration,
        moduleKey,
        app,
      );
      expect(createMiddlewareFactoryStub.calledOnce).to.be.true;
    });
  });
  describe('getPaths', () => {
    it(`should return correct paths`, () => {
      (middlewareModule as any).config.enableVersioning({
        type: VersioningType.URI,
      });

      const paths = (middlewareModule as any).getPaths({
        path: '*',
        method: RequestMethod.ALL,
      });
      expect(paths).to.eql(['/*']);

      const versioningPaths = (middlewareModule as any).getPaths({
        path: '*',
        method: RequestMethod.ALL,
        version: '1',
      });
      expect(versioningPaths).to.eql(['/v1/*']);
    });
    it(`should return correct paths when set global prefix`, () => {
      (middlewareModule as any).config.enableVersioning({
        type: VersioningType.URI,
      });
      (middlewareModule as any).config.setGlobalPrefix('api');

      const paths = (middlewareModule as any).getPaths({
        path: '*',
        method: RequestMethod.ALL,
      });
      expect(paths).to.eql(['/api/*']);

      const versioningPaths = (middlewareModule as any).getPaths({
        path: '*',
        method: RequestMethod.ALL,
        version: '1',
      });
      expect(versioningPaths).to.eql(['/api/v1/*']);
    });
    it(`should return correct paths when set global prefix and global prefix options`, () => {
      (middlewareModule as any).config.enableVersioning({
        type: VersioningType.URI,
      });
      (middlewareModule as any).config.setGlobalPrefix('api');
      (middlewareModule as any).config.setGlobalPrefixOptions({
        exclude: mapToExcludeRoute(['foo']),
      });

      const allPaths = (middlewareModule as any).getPaths({
        path: '*',
        method: RequestMethod.ALL,
      });
      expect(allPaths).to.eql(['/api/*', '/foo']);

      const allVersioningPaths = (middlewareModule as any).getPaths({
        path: '*',
        method: RequestMethod.ALL,
        version: '1',
      });
      expect(allVersioningPaths).to.eql(['/api/v1/*', '/v1/foo']);

      const excludedPaths = (middlewareModule as any).getPaths({
        path: 'foo',
        method: RequestMethod.ALL,
        version: '1',
      });
      expect(excludedPaths).to.eql(['/v1/foo']);

      const normalPaths = (middlewareModule as any).getPaths({
        path: 'bar',
        method: RequestMethod.ALL,
        version: '1',
      });
      expect(normalPaths).to.eql(['/api/v1/bar']);
    });
  });
});
